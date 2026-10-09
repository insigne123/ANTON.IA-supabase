import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import type { CoworkUpload } from './uploads';
import { coworkCodeProposalSchema, hashCoworkCodeProposal, type CoworkCodeProposal } from '@/lib/cowork/code-proposal';
import { createExecutorBuildProvider, CoworkBuildPending, CoworkBuildOutcomeUnknown, coworkBuildIdentity } from './build-provider';
import { listCoworkObservedFiles } from './observed-files';

/** Fase 3: run owner-reviewed code on the isolated remote executor.
 * The proposal pins language+code+inputs by hash; execution refuses drift.
 * Code execution never self-approves: it always waits for a human decision. */

const UPLOAD_BUCKET = 'cowork-uploads';
const ARTIFACT_BUCKET = 'cowork-artifacts';
const OUTPUT_EXTENSIONS = new Set(['csv', 'json', 'md', 'txt', 'xlsx', 'docx', 'pptx', 'zip', 'html', 'css', 'js', 'mjs', 'png', 'svg', 'pdf']);
// Zip-family outputs must be real containers, not renamed text: magic bytes
// always, plus the OOXML content-type marker for office documents (a plain
// user-built zip legitimately lacks it).
const ZIP_FAMILY = new Set(['xlsx', 'docx', 'pptx', 'zip']);
const OFFICE_FAMILY = new Set(['xlsx', 'docx', 'pptx']);
export const coworkCodeInputManifestSchema = z.object({ version: z.literal(1), codeHash: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(z.object({ name: z.string(), size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(8) });
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const frozenPrefix = (scope: { userId: string; organizationId: string }, runId: string, hash: string) => `${uploadPrefix(scope, runId)}/frozen/${hash}`;

function executorConfig() {
  const url = (process.env.COWORK_EXECUTOR_URL || '').trim().replace(/\/+$/, '');
  const secret = (process.env.COWORK_EXECUTOR_SECRET || '').trim();
  if (!url || !secret) throw new Error('La ejecución de código todavía no está configurada. Falta COWORK_EXECUTOR_URL o COWORK_EXECUTOR_SECRET.');
  if (!/^https:\/\//i.test(url)) throw new Error('La URL del ejecutor debe usar HTTPS.');
  return { url, secret };
}

function uploadPrefix(scope: { userId: string; organizationId: string }, runId: string) {
  return `${scope.organizationId}/${scope.userId}/${runId}`;
}

function sanitizeOutputName(raw: unknown) {
  const name = String(raw || '').trim();
  if (!name || name.length > 120 || name !== name.trim() || name.includes('/') || name.includes('\\') || name.includes('\0') || name.startsWith('.')) {
    throw new Error('El ejecutor devolvió un nombre de archivo inválido.');
  }
  const dot = name.lastIndexOf('.');
  if (dot < 1 || !OUTPUT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())) {
    throw new Error('El ejecutor devolvió una extensión no permitida.');
  }
  return name;
}

function validateOutputBytes(name: string, bytes: Buffer) {
  if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) {
    throw new Error('El ejecutor devolvió un archivo inválido.');
  }
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (ZIP_FAMILY.has(ext)) {
    const magic = bytes.subarray(0, 4);
    const isZip = magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04;
    const head = bytes.subarray(0, Math.min(bytes.length, 65536)).toString('binary');
    if (!isZip || (OFFICE_FAMILY.has(ext) && !head.includes('[Content_Types].xml'))) {
      throw new Error(`El archivo ${name} no es un documento válido.`);
    }
  }
}

export async function stageCoworkCode(
  scope: { userId: string; organizationId: string },
  runId: string,
  proposal: CoworkCodeProposal,
): Promise<{ files: number }> {
  const parsed = coworkCodeProposalSchema.parse(proposal);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  // Input files are the person's own uploads. «Adjuntar archivos» stores them in
  // the turn on screen, an earlier run than the one proposing code, so a file
  // missing here is copied now from its newest upload: execution still reads
  // only this run's prefix, and it runs on the copy the person reviewed.
  if (parsed.inputFiles.length > 0) {
    const bucket = client.storage.from(UPLOAD_BUCKET);
    const { data, error } = await bucket.list(uploadPrefix(scope, runId), { limit: 50 });
    if (error) throw new Error('No se pudieron verificar los archivos de entrada.');
    const available = new Set((data || []).map(file => file.name.toLowerCase()));
    const missing = parsed.inputFiles.filter(name => !available.has(name.toLowerCase()));
    const uploads = missing.length ? await listCoworkObservedFiles(client, scope) : new Map<string, CoworkUpload[]>();
    for (const name of missing) {
      const stored = [...uploads.keys()].find(key => key.toLowerCase() === name.toLowerCase());
      const newest = stored ? uploads.get(stored)?.[0] : undefined;
      if (!stored || !newest) throw new Error(`El archivo ${name} no está entre tus archivos subidos.`);
      if ('bucket' in newest && newest.bucket === 'cowork-artifacts') {
        const file = await client.storage.from(ARTIFACT_BUCKET).download(`${uploadPrefix(scope, newest.runId)}/${stored}`);
        if (file.error || !file.data) throw new Error('No se pudo recuperar el asset del workspace.');
        const bytes = Buffer.from(await file.data.arrayBuffer());
        if ('sha256' in newest && newest.sha256 && digest(bytes) !== newest.sha256) throw new Error('El asset no coincide con su revisión publicada.');
        const copied = await bucket.upload(`${uploadPrefix(scope, runId)}/${name}`, bytes, { upsert: false });
        if (copied.error) throw new Error('No se pudo fijar el asset como entrada del nuevo trabajo.');
        continue;
      }
      const copied = await bucket.copy(`${uploadPrefix(scope, newest.runId)}/${stored}`, `${uploadPrefix(scope, runId)}/${name}`);
      if (copied.error) throw new Error(`No se pudo preparar el archivo ${name}.`);
    }
  }
  const hash = hashCoworkCodeProposal(parsed);
  const bucket = client.storage.from(UPLOAD_BUCKET);
  const frozen = frozenPrefix(scope, runId, hash);
  const existingManifest = await bucket.download(`${frozen}/manifest.json`);
  if (!existingManifest.data) {
    const manifest: z.infer<typeof coworkCodeInputManifestSchema> = { version: 1, codeHash: hash, files: [] };
    let total = 0;
    for (const name of parsed.inputFiles) {
      const downloaded = await bucket.download(`${uploadPrefix(scope, runId)}/${name}`);
      if (downloaded.error || !downloaded.data) throw new Error(`No se pudo fijar la versión de ${name} para revisar.`);
      const bytes = Buffer.from(await downloaded.data.arrayBuffer()); total += bytes.length;
      if (!bytes.length || total > 20 * 1024 * 1024) throw new Error('Las entradas exceden el límite.');
      const stored = await bucket.upload(`${frozen}/inputs/${name}`, bytes, { upsert: false });
      if (stored.error) {
        const prior = await bucket.download(`${frozen}/inputs/${name}`);
        if (prior.error || !prior.data || digest(Buffer.from(await prior.data.arrayBuffer())) !== digest(bytes)) throw new Error('La entrada ya tiene otra revisión.');
      }
      manifest.files.push({ name, size: bytes.length, sha256: digest(bytes) });
    }
    const saved = await bucket.upload(`${frozen}/manifest.json`, Buffer.from(JSON.stringify(manifest)), { upsert: false, contentType: 'application/json' });
    if (saved.error) {
      const prior = await bucket.download(`${frozen}/manifest.json`);
      if (prior.error || !prior.data || JSON.stringify(JSON.parse(Buffer.from(await prior.data.arrayBuffer()).toString('utf8'))) !== JSON.stringify(manifest)) throw new Error('No se pudo fijar el manifiesto de entrada.');
    }
  }
  const staged = await client.from('cowork_code_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      language: parsed.language, code: parsed.code, input_files: parsed.inputFiles,
      code_hash: hashCoworkCodeProposal(parsed) },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar la propuesta de código.');
  if (!staged.data) {
    const existing = await client.from('cowork_code_proposals').select('code_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.code_hash !== hashCoworkCodeProposal(parsed)) {
      throw new Error('Este trabajo ya tiene otra propuesta de código.');
    }
  }
  return { files: parsed.inputFiles.length };
}

const codeTargetSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});

export function parseCoworkCodeTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 2 || parts[0] !== 'code') throw new Error('La propuesta de código no es válida.');
  return codeTargetSchema.parse({ hash: parts[1] });
}

type ExecutorResult = {
  status: 'completed' | 'failed' | 'timeout';
  exitCode: number; stdout: string; stderr: string;
  files: Array<{ name: string; size: number; contentBase64: string; sha256?: string }>;
  durationMs: number; reused?: boolean;
};

async function callExecutor(url: string, secret: string, body: unknown): Promise<ExecutorResult> {
  let response;
  try {
    response = await fetch(`${url}/v1/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150000),
    });
  } catch {
    throw new Error('No se pudo contactar el ejecutor. Inténtalo más tarde.');
  }
  if (response.status === 409) {
    const conflict = await response.json().catch(() => ({})) as { error?: string };
    if (/busy/i.test(String(conflict.error || ''))) {
      throw new Error('El ejecutor está ocupado con otro trabajo. Vuelve a intentarlo en unos minutos.');
    }
    throw new Error('La propuesta cambió desde la revisión. Pide una nueva revisión.');
  }
  if (response.status === 401 || response.status === 403) throw new Error('El ejecutor rechazó la credencial.');
  if (!response.ok) throw new Error('El ejecutor devolvió un error. Inténtalo más tarde.');
  const result = await response.json().catch(() => null) as ExecutorResult | null;
  if (!result || !['completed', 'failed', 'timeout'].includes(result.status)) {
    throw new Error('El ejecutor devolvió una respuesta inválida.');
  }
  return result;
}

export async function executeCoworkCode(auth: AuthContext, runId: string, targetId: string, attemptAt?: string) {
  const target = parseCoworkCodeTarget(targetId);
  const userId = auth.user.id;
  const organizationId = auth.organizationId;
  const scope = { userId, organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('El código a ejecutar ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const row = await client.from('cowork_code_proposals').select('language,code,input_files,code_hash')
    .eq('run_id', runId).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('La propuesta aprobada ya no está disponible.');
  const staged = { language: row.data.language, code: row.data.code, inputFiles: row.data.input_files || [] } as CoworkCodeProposal;
  const parsed = coworkCodeProposalSchema.parse(staged);
  if (hashCoworkCodeProposal(parsed) !== target.hash) {
    throw new Error('El código cambió desde tu revisión. Pide una nueva revisión.');
  }
  const { url, secret } = executorConfig();
  const frozen = frozenPrefix(scope, runId, target.hash);
  const pinned = await client.storage.from(UPLOAD_BUCKET).download(`${frozen}/manifest.json`);
  if (pinned.error || !pinned.data) throw new Error('Este código necesita una nueva revisión para fijar sus archivos de entrada.');
  const manifest = coworkCodeInputManifestSchema.parse(JSON.parse(Buffer.from(await pinned.data.arrayBuffer()).toString('utf8')));
  if (manifest.codeHash !== target.hash || JSON.stringify(manifest.files.map(file => file.name)) !== JSON.stringify(parsed.inputFiles)) throw new Error('Las entradas cambiaron desde tu revisión.');
  // Download inputs from the run prefix; fail closed on any storage error.
  const files: Array<{ name: string; contentBase64: string }> = [];
  for (const name of parsed.inputFiles) {
    const { data, error } = await client.storage.from(UPLOAD_BUCKET)
      .download(`${frozen}/inputs/${name}`);
    if (error || !data) throw new Error(`No se pudo leer el archivo ${name}.`);
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) throw new Error(`El archivo ${name} excede el límite.`);
    const fixed = manifest.files.find(file => file.name === name)!;
    if (bytes.length !== fixed.size || digest(bytes) !== fixed.sha256) throw new Error('Las entradas cambiaron desde tu revisión.');
    files.push({ name, contentBase64: bytes.toString('base64') });
  }
  await requireCoworkWorkerAccess(client, scope);
  const body = {
    idempotencyKey: coworkBuildIdentity(runId),
    language: parsed.language, code: parsed.code, files,
  };
  let result: ExecutorResult;
  if (process.env.COWORK_EXECUTOR_ASYNC_ENABLED === 'true') {
    if (process.env.COWORK_CODE_FENCING_ENABLED !== 'true' || !attemptAt) throw new Error('El trabajo cloud necesita configurar su cierre por intento antes de ejecutarse.');
    const provider = createExecutorBuildProvider(url, secret);
    await provider.capabilities();
    const requestHash = createHash('sha256').update(body.language).update('\0').update(body.code).update('\0').update('120000');
    for (const file of body.files) requestHash.update('\0').update(file.name).update('\0').update(Buffer.from(file.contentBase64, 'base64'));
    const expectedHash = requestHash.digest('hex');
    let job = await provider.inspect(body.idempotencyKey);
    if (!job) {
      // A result may have expired remotely after admission. Persist intent before the first POST and never re-admit a missing retained identity.
      const marked = await client.rpc('cowork_mark_code_dispatch', { p_run_id: runId, p_user_id: userId, p_organization_id: organizationId,
        p_attempt_at: attemptAt, p_job_id: body.idempotencyKey, p_request_hash: expectedHash });
      if (marked.error) throw new Error('No se pudo conservar la admisión del trabajo cloud.');
      if (marked.data !== true) throw new CoworkBuildOutcomeUnknown('La identidad del trabajo ya fue admitida o perdió su intento. No se repite automáticamente si el ejecutor ya no conserva el resultado.');
      job = await provider.admit(body);
    }
    if (job.requestHash !== expectedHash) throw new CoworkBuildOutcomeUnknown('El trabajo cloud no corresponde a los inputs revisados.');
    // Cancellation can race the short admission POST. Check again and stop the same job even if DELETE initially saw no remote job.
    const afterAdmission = await getCoworkRun(auth, runId);
    try {
      await requireCoworkWorkerAccess(client, scope);
      if (!afterAdmission || afterAdmission.run.status !== 'waiting_approval') throw new Error('El trabajo se detuvo; no se publicarán sus archivos.');
    } catch (error) { await provider.cancel(body.idempotencyKey).catch(() => null); throw error; }
    if (['queued', 'running', 'cancel_requested'].includes(job.status)) throw new CoworkBuildPending(job);
    if (!job.result || !['completed', 'failed', 'timeout'].includes(job.status)) throw new CoworkBuildOutcomeUnknown('El trabajo fue interrumpido o su resultado no pudo confirmarse. Conservamos su identidad; no lo repetimos automáticamente.');
    result = job.result as ExecutorResult;
  } else result = await callExecutor(url, secret, body);
  const current = await getCoworkRun(auth, runId);
  await requireCoworkWorkerAccess(client, scope);
  if (!current || !['completed', 'waiting_approval'].includes(current.run.status)) throw new Error('El trabajo se detuvo; no se publicarán sus archivos.');
  // Stage the immutable files; the caller publishes the complete manifest through the fenced finish RPC.
  const artifacts: Array<{ name: string; size: number; sha256: string }> = [];
  const outputs = result.status === 'completed' ? result.files || [] : [];
  if (outputs.length > 16 || new Set(outputs.map(file => file.name)).size !== outputs.length) throw new Error('El ejecutor devolvió demasiados archivos o nombres duplicados.');
  const validated = outputs.map(file => {
    const name = sanitizeOutputName(file.name), bytes = Buffer.from(String(file.contentBase64 || ''), 'base64');
    validateOutputBytes(name, bytes);
    if (file.sha256 && file.sha256 !== digest(bytes)) throw new Error('El contenido no coincide con el manifiesto de salida.');
    if (file.size !== bytes.length) throw new Error('El tamaño del archivo no coincide con el manifiesto.');
    return { name, bytes };
  });
  if (validated.reduce((sum, file) => sum + file.bytes.length, 0) > 10 * 1024 * 1024) throw new Error('Las salidas exceden 10 MB.');
  for (const file of validated) {
    const { name, bytes } = file;
    const path = `${scope.organizationId}/${scope.userId}/${runId}/${name}`;
    const uploaded = await client.storage.from(ARTIFACT_BUCKET).upload(path, bytes, { upsert: false });
    if (uploaded.error) {
      const prior = await client.storage.from(ARTIFACT_BUCKET).download(path);
      if (prior.error || !prior.data || digest(Buffer.from(await prior.data.arrayBuffer())) !== digest(bytes)) throw new Error('No se pudieron guardar los archivos de salida sin cambiar otra revisión.');
    }
    artifacts.push({ name, size: bytes.length, sha256: digest(bytes) });
  }
  // Publish the set only after every file validates and uploads. No per-file event appears before the set is ready.
  const beforePublish = await getCoworkRun(auth, runId);
  await requireCoworkWorkerAccess(client, scope);
  if (!beforePublish || !['completed', 'waiting_approval'].includes(beforePublish.run.status)) throw new Error('El trabajo se detuvo; sus archivos no se publicaron.');
  // The caller publishes the complete manifest in the existing attempt/state-fenced finish RPC.
  const excerpt = String(result.stdout || '').slice(0, 1500);
  if (result.status === 'completed') {
    return { reply: `Código ${parsed.language} ejecutado en entorno aislado (${result.durationMs} ms).${artifacts.length ? ` Archivos: ${artifacts.map(file => file.name).join(', ')}.` : ' Sin archivos de salida.'}${excerpt ? `\nSalida:\n${excerpt}` : ''}`,
      result: { status: result.status, durationMs: result.durationMs, files: artifacts, codeHash: target.hash,
        deliverableSet: { version: 1, resultId: `${runId}:deliverables:${target.hash}`, primary: artifacts.find(file => /\.(?:html|pdf|docx)$/i.test(file.name))?.name ?? artifacts[0]?.name ?? null,
          checks: { rendered: 'not_measured', semantic: 'not_measured' } }, stdoutExcerpt: excerpt } };
  }
  if (result.status === 'timeout') {
    throw new Error(`El código superó el tiempo máximo (120 s) y se detuvo. Simplifícalo o divídelo.${excerpt ? `\nSalida parcial:\n${excerpt}` : ''}`.slice(0, 1200));
  }
  throw new Error(`El código terminó con error (salida ${result.exitCode}).${excerpt ? `\nSalida:\n${excerpt}` : ''}${result.stderr ? `\nError:\n${String(result.stderr).slice(0, 800)}` : ''}`.slice(0, 1600));
}
