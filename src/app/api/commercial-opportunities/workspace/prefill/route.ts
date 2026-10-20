import { createHash, randomUUID } from 'node:crypto';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityAdmin } from '@/lib/server/commercial-opportunities/workspace-access';
import { extractOpportunityFile, opportunityLegacyAsText, opportunityMime } from '@/lib/server/commercial-opportunities/workspace-documents';
import { DocumentFileError } from '@/lib/server/commercial-opportunities/document-files';
import { opportunityDb } from '@/lib/server/commercial-opportunities/workspace-store';
import { runQueuedOpportunityJobNow } from '@/lib/server/commercial-opportunities/workspace-jobs';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { prefillText } from '@/lib/commercial-opportunities/prefill';
import { SCAN_IMAGE_TOKENS, SCAN_MAX_PAGES, SCAN_PAGE_TOKENS, isScanImage, scanPages } from '@/lib/commercial-opportunities/document-scans';
import { AuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * «Cargar oportunidad» from a document: its text is read here, the model proposes the form's fields (prefill.ts) and the
 * person reviews them. The document is not saved: the form uploads it with the opportunity, as one of its bases.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    assertOpportunityAdmin(scope);
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new AuthError('Elige el documento que recibiste.', 400);
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
    // A scan or a photo: the model reads the file itself (document-scans.ts), within the same limits as the expediente.
    const scanned = extracted.status === 'scan';
    const image = isScanImage(name);
    if (scanned && !scanPages({ name, bytes: bytes.length, status: 'scan', pagesTotal: extracted.total })) throw new AuthError(image
      ? 'La imagen pesa más de 3,7 MB. Guárdala más liviana, como JPG, o escribe los datos.'
      : `El documento está escaneado y tiene más de ${SCAN_MAX_PAGES} páginas. Sube solo la invitación o escribe los datos.`, 422);
    const text = scanned ? '' : prefillText(extracted.sections);
    if (!scanned && text.length < 40) throw new AuthError('No encontramos texto en el documento. Escribe los datos.', 422);
    const key = `prefill:${randomUUID()}`;
    opportunityDb(await auth.admin.from('opportunity_jobs').insert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'evaluate',
      dedupe_key: key, payload: { prefill: true, name: file.name.slice(0, 200), text, ...(scanned ? { scanned: true, sha: createHash('sha256').update(bytes).digest('hex'),
        attachmentTokens: image ? SCAN_IMAGE_TOKENS : (extracted.total || 1) * SCAN_PAGE_TOKENS } : {}) } }));
    await runQueuedOpportunityJobNow(auth.admin, scope.organizationId, key, 'evaluate',
      scanned ? [{ kind: image ? 'image' : 'pdf', mediaType: mime, data: Buffer.from(bytes).toString('base64') }] : undefined);
    const job = opportunityDb(await auth.admin.from('opportunity_jobs').select('id,state,result,error').eq('organization_id', scope.organizationId).eq('dedupe_key', key).maybeSingle());
    // The document's text stays only while it is read.
    if (job?.id) await auth.admin.from('opportunity_jobs').update({ payload: { prefill: true, name: file.name.slice(0, 200) } }).eq('id', job.id);
    if (job?.state !== 'ready' || !job.result?.fields) throw new AuthError(job?.error || 'La IA no pudo leer el documento. Intenta de nuevo o escribe los datos.', 503);
    return opportunitiesJson({ fields: job.result.fields, missing: job.result.missing || [], partial: extracted.status === 'partial' || text.length >= 50_000 });
  } catch (error) { return opportunitiesError(error); }
}
