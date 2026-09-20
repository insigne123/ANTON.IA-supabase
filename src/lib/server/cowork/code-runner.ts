import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { coworkCodeProposalSchema, hashCoworkCodeProposal, type CoworkCodeProposal } from '@/lib/cowork/code-proposal';

/** Fase 3: run owner-reviewed code on the isolated remote executor.
 * The proposal pins language+code+inputs by hash; execution refuses drift.
 * Code execution never self-approves: it always waits for a human decision. */

const UPLOAD_BUCKET = 'cowork-uploads';
const ARTIFACT_BUCKET = 'cowork-artifacts';
const OUTPUT_EXTENSIONS = new Set(['csv', 'json', 'md', 'txt', 'xlsx', 'png', 'svg', 'pdf']);

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

export async function stageCoworkCode(
  scope: { userId: string; organizationId: string },
  runId: string,
  proposal: CoworkCodeProposal,
): Promise<{ files: number }> {
  const parsed = coworkCodeProposalSchema.parse(proposal);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  // Input files must exist under this run's upload prefix: no cross-run reads.
  if (parsed.inputFiles.length > 0) {
    const { data, error } = await client.storage.from(UPLOAD_BUCKET).list(uploadPrefix(scope, runId), { limit: 50 });
    if (error) throw new Error('No se pudieron verificar los archivos de entrada.');
    const available = new Set((data || []).map(file => file.name.toLowerCase()));
    for (const name of parsed.inputFiles) {
      if (!available.has(name.toLowerCase())) throw new Error(`El archivo ${name} no está subido en este trabajo.`);
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
  files: Array<{ name: string; size: number; contentBase64: string }>;
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

export async function executeCoworkCode(auth: AuthContext, runId: string, targetId: string) {
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
  // Download inputs from the run prefix; fail closed on any storage error.
  const files: Array<{ name: string; contentBase64: string }> = [];
  for (const name of parsed.inputFiles) {
    const { data, error } = await client.storage.from(UPLOAD_BUCKET)
      .download(`${uploadPrefix(scope, runId)}/${name}`);
    if (error || !data) throw new Error(`No se pudo leer el archivo ${name}.`);
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) throw new Error(`El archivo ${name} excede el límite.`);
    files.push({ name, contentBase64: bytes.toString('base64') });
  }
  await requireCoworkWorkerAccess(client, scope);
  const result = await callExecutor(url, secret, {
    idempotencyKey: `cowork-code-${runId}`,
    language: parsed.language, code: parsed.code, files,
  });
  // Promote outputs to private storage before replying; record each artifact.
  const artifacts: Array<{ name: string; size: number }> = [];
  for (const file of result.files || []) {
    const name = sanitizeOutputName(file.name);
    const bytes = Buffer.from(String(file.contentBase64 || ''), 'base64');
    if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) throw new Error('El ejecutor devolvió un archivo inválido.');
    const path = `${scope.organizationId}/${scope.userId}/${runId}/${name}`;
    const uploaded = await client.storage.from(ARTIFACT_BUCKET).upload(path, bytes, { upsert: true });
    if (uploaded.error) throw new Error('No se pudieron guardar los archivos de salida.');
    artifacts.push({ name, size: bytes.length });
    await client.from('cowork_run_events').insert({
      run_id: runId, user_id: userId, organization_id: organizationId,
      kind: 'artifact.created', payload: { name, path, size: bytes.length },
    });
  }
  const excerpt = String(result.stdout || '').slice(0, 1500);
  if (result.status === 'completed') {
    return { reply: `Código ${parsed.language} ejecutado en entorno aislado (${result.durationMs} ms).${artifacts.length ? ` Archivos: ${artifacts.map(file => file.name).join(', ')}.` : ' Sin archivos de salida.'}${excerpt ? `\nSalida:\n${excerpt}` : ''}`,
      result: { status: result.status, durationMs: result.durationMs, files: artifacts, stdoutExcerpt: excerpt } };
  }
  if (result.status === 'timeout') {
    throw new Error(`El código superó el tiempo máximo (120 s) y se detuvo. Simplifícalo o divídelo.${excerpt ? `\nSalida parcial:\n${excerpt}` : ''}`.slice(0, 1200));
  }
  throw new Error(`El código terminó con error (salida ${result.exitCode}).${excerpt ? `\nSalida:\n${excerpt}` : ''}${result.stderr ? `\nError:\n${String(result.stderr).slice(0, 800)}` : ''}`.slice(0, 1600));
}
