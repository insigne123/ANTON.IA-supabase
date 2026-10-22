import { createHash, randomUUID } from 'node:crypto';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityAdmin } from '@/lib/server/commercial-opportunities/workspace-access';
import { extractOpportunityFile, opportunityLegacyAsText, opportunityMime } from '@/lib/server/commercial-opportunities/workspace-documents';
import { DocumentFileError } from '@/lib/server/commercial-opportunities/document-files';
import { opportunityDb } from '@/lib/server/commercial-opportunities/workspace-store';
import { runQueuedOpportunityJobNow } from '@/lib/server/commercial-opportunities/workspace-jobs';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { prefillText } from '@/lib/commercial-opportunities/prefill';
import { PREFILL_MAX_BYTES, PREFILL_MAX_FILES, prefillPackageText } from '@/lib/commercial-opportunities/prefill-package';
import { SCAN_IMAGE_TOKENS, SCAN_MAX_PAGES, SCAN_PAGE_TOKENS, isScanImage, scanPages } from '@/lib/commercial-opportunities/document-scans';
import { AuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** One uploaded file as the expediente reads it: legacy formats converted, type checked, text extracted. The errors say what to do. */
async function readPrefillFile(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new AuthError('El documento pasa de 20 MB. Sube solo la invitación o las bases.', 413);
  let name = file.name || 'documento';
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  const legacy = await opportunityLegacyAsText(name, bytes).catch(error => { throw error instanceof DocumentFileError ? new AuthError(error.message, 422) : error; });
  if (legacy) ({ name, bytes } = legacy);
  const mime = opportunityMime(name);
  if (!mime) throw new AuthError('Usa un PDF, un Word, un Excel, un archivo de texto o una imagen JPG o PNG.', 400);
  const extracted = await extractOpportunityFile(name, bytes).catch(error => {
    if (error instanceof AuthError) throw error;
    throw new AuthError('No pudimos leer el documento. Revisa que abra bien o escribe los datos.', 422);
  });
  return { file, name, bytes, mime, extracted };
}

/**
 * «Cargar oportunidad» from a document or a package of them (the bases of a private process: invitation, conditions, technical
 * bases, contract, annexes): the text is read here, the model proposes the form's fields (prefill.ts) and the person reviews them.
 * The documents are not saved: the form uploads them with the opportunity, as its bases. A package is read together
 * (prefill-package.ts); a scan or a photo is read by the model itself only when it is the one document.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    assertOpportunityAdmin(scope);
    const form = await request.formData().catch(() => null);
    const files = (form?.getAll('file') ?? []).filter((file): file is File => typeof file !== 'string');
    if (!files.length) throw new AuthError('Elige el documento que recibiste.', 400);
    if (files.length > PREFILL_MAX_FILES) throw new AuthError(`Sube hasta ${PREFILL_MAX_FILES} documentos para que la IA los lea juntos; el resto puedes subirlo después en Documentos.`, 413);
    if (files.reduce((sum, file) => sum + file.size, 0) > PREFILL_MAX_BYTES) throw new AuthError('Los documentos pasan de 24 MB juntos. Sube primero la invitación y las bases.', 413);

    let text = '', label = '', count = 1, partial = false;
    let scanBytes: Uint8Array | null = null, scanMime = '', scanImage = false, scanTotal = 0;
    const read: string[] = [], skipped: Array<{ name: string; why: string }> = [];
    if (files.length === 1) {
      const one = await readPrefillFile(files[0]);
      // A scan or a photo: the model reads the file itself (document-scans.ts), within the same limits as the expediente.
      const scanned = one.extracted.status === 'scan';
      const image = isScanImage(one.name);
      if (scanned && !scanPages({ name: one.name, bytes: one.bytes.length, status: 'scan', pagesTotal: one.extracted.total })) throw new AuthError(image
        ? 'La imagen pesa más de 3,7 MB. Guárdala más liviana, como JPG, o escribe los datos.'
        : `El documento está escaneado y tiene más de ${SCAN_MAX_PAGES} páginas. Sube solo la invitación o escribe los datos.`, 422);
      text = scanned ? '' : prefillText(one.extracted.sections);
      if (!scanned && text.length < 40) throw new AuthError('No encontramos texto en el documento. Escribe los datos.', 422);
      label = files[0].name; partial = one.extracted.status === 'partial' || text.length >= 50_000; read.push(one.name);
      if (scanned) { scanBytes = one.bytes; scanMime = one.mime; scanImage = image; scanTotal = one.extracted.total || 1; }
    } else {
      const opened: Awaited<ReturnType<typeof readPrefillFile>>[] = [];
      for (const file of files) {
        try { opened.push(await readPrefillFile(file)); }
        catch (error) { skipped.push({ name: file.name, why: error instanceof AuthError ? error.message : 'No pudimos leerlo.' }); }
      }
      const usable = opened.filter(item => item.extracted.status !== 'scan');
      for (const item of opened.filter(item => item.extracted.status === 'scan')) skipped.push({ name: item.name, why: 'Está escaneado: la IA solo lo lee si lo subes solo.' });
      const joined = prefillPackageText(usable.map(item => ({ name: item.name, sections: item.extracted.sections })));
      if (joined.text.length < 40) throw new AuthError('No encontramos texto en los documentos. Escribe los datos.', 422);
      text = joined.text; count = usable.length; read.push(...usable.map(item => item.name));
      label = `${count} documentos`; partial = joined.partial || usable.some(item => item.extracted.status === 'partial');
    }

    const key = `prefill:${randomUUID()}`;
    opportunityDb(await auth.admin.from('opportunity_jobs').insert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'evaluate',
      dedupe_key: key, payload: { prefill: true, name: label.slice(0, 200), documents: count, text, ...(scanBytes ? { scanned: true, sha: createHash('sha256').update(scanBytes).digest('hex'),
        attachmentTokens: scanImage ? SCAN_IMAGE_TOKENS : scanTotal * SCAN_PAGE_TOKENS } : {}) } }));
    await runQueuedOpportunityJobNow(auth.admin, scope.organizationId, key, 'evaluate',
      scanBytes ? [{ kind: scanImage ? 'image' : 'pdf', mediaType: scanMime, data: Buffer.from(scanBytes).toString('base64') }] : undefined);
    const job = opportunityDb(await auth.admin.from('opportunity_jobs').select('id,state,result,error').eq('organization_id', scope.organizationId).eq('dedupe_key', key).maybeSingle());
    // The documents' text stays only while it is read.
    if (job?.id) await auth.admin.from('opportunity_jobs').update({ payload: { prefill: true, name: label.slice(0, 200), documents: count } }).eq('id', job.id);
    if (job?.state !== 'ready' || !job.result?.fields) throw new AuthError(job?.error || 'La IA no pudo leer el documento. Intenta de nuevo o escribe los datos.', 503);
    return opportunitiesJson({ fields: job.result.fields, missing: job.result.missing || [], partial, read, skipped });
  } catch (error) { return opportunitiesError(error); }
}
