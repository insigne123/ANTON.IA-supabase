import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { OPPORTUNITY_BUCKET, type WorkScope } from '@/lib/commercial-opportunities/workspace';
import { coworkHtmlToText, coworkExcelTable } from '@/lib/server/cowork/file-binary';
import { coworkZipGuard } from '@/lib/cowork/zip-guard';
import { assertOpportunityRead } from './workspace-access';
import { opportunityDb } from './workspace-store';
import { DocumentFileError, opportunityLegacyAsText, opportunityStorageName } from './document-files';

export { opportunityLegacyAsText, opportunityStorageName };

export type ExtractedOpportunityFile = { status: 'read' | 'partial' | 'scan' | 'damaged'; total: number | null; read: number; sections: Array<{ locator: string; text: string }> };
export const opportunityMime = (name: string) => ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', htm: 'text/html' }[name.toLowerCase().split('.').pop() || '']);
export async function extractOpportunityFile(name: string, bytes: Uint8Array): Promise<ExtractedOpportunityFile> {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    const { getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const sections: ExtractedOpportunityFile['sections'] = [];
    const start = Date.now(); let pages = 0;
    try {
      for (let page = 1; page <= Math.min(pdf.numPages, 300); page++) {
        if (Date.now() - start > 45_000) break;
        const content = await (await pdf.getPage(page)).getTextContent();
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
        sections.push({ locator: `Página ${page}`, text }); pages++;
      }
      return { status: !sections.some(s => s.text.length > 30) ? 'scan' : pages < pdf.numPages || sections.some(s => s.text.length < 30) ? 'partial' : 'read', total: pdf.numPages, read: pages, sections };
    } finally { await pdf.loadingTask.destroy().catch(() => undefined); }
  }
  if (ext === 'docx') {
    const guard = coworkZipGuard(bytes);
    if (!guard.ok || guard.xmlBytes > 6 * 1024 * 1024) throw new AuthError('El documento Word no puede procesarse con estos límites.', 413);
    const mammoth = await import('mammoth'); const lib = mammoth.default ?? mammoth;
    let images=false;
    const { value } = await lib.convertToHtml({ buffer: Buffer.from(bytes) }, { convertImage: lib.images.imgElement(async () => {images=true;return { src: '' };}) });
    return { status: images?'partial':'read', total: null, read: 0, sections: [{ locator: 'Texto y tablas de Word', text: coworkHtmlToText(value) }] };
  }
  if (ext === 'xlsx') {
    const first = await coworkExcelTable(bytes);
    if ('unreadable' in first) throw new AuthError('No se pudo leer la planilla.', 422);
    const sections = []; let partial = first.table.sheets.length >= 12;
    for (const sheet of first.table.sheets) {
      const opened = await coworkExcelTable(bytes, { sheet: sheet.name });
      if ('unreadable' in opened) { partial = true; continue; }
      partial ||= opened.table.capped;
      const table = opened.table;
      sections.push({ locator: `Hoja ${sheet.name}`, text: [...table.above, table.columns.join(' | '), ...table.body.map((row, i) => `Fila ${i + 2}: ${row.map(String).join(' | ')}`)].join('\n') });
    }
    return { status: partial ? 'partial' : 'read', total: null, read: 0, sections };
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const page = ext === 'html' || ext === 'htm';
  const plain=page?coworkHtmlToText(webPageBody(text)):text;
  return { status:plain.trim()?'read':'damaged', total: null, read: 0, sections: [{ locator: page ? 'Página web' : 'Texto recibido', text: plain }] };
}
/**
 * What a captured web page says, without what the browser runs or draws: its head, scripts, styles, comments, SVG and
 * hidden fields. Mercado Público's ficha carries kilobytes of CSS and JavaScript that read as text otherwise, and they
 * reached the report and the chat as «fragments» of the expediente.
 */
export function webPageBody(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style|link|meta|input)\b[^>]*\/?>/gi, ' ');
}
export function opportunityTextChunks(sections: ExtractedOpportunityFile['sections']) {
  let ordinal = 0;
  return sections.flatMap(section => {
    const parts = [];
    for (let i = 0; i < section.text.length; i += 6000) parts.push({ id: randomUUID(), ordinal: ordinal++, locator: `${section.locator}${section.text.length > 6000 ? ` · bloque ${Math.floor(i / 6000) + 1}` : ''}`, content: section.text.slice(i, i + 6000) });
    return parts;
  });
}
export async function saveOpportunityDocument(client: SupabaseClient, scope: WorkScope, id: string, input: {
  name: string; bytes: Uint8Array; sourceKind: 'upload' | 'pasted' | 'official' | 'public_web'; sourceUrl?: string;
}) {
  await assertOpportunityRead(client, scope, id);
  if (input.bytes.length < 1 || input.bytes.length > 20 * 1024 * 1024) throw new AuthError('Cada documento puede pesar hasta 20 MB.', 400);
  const legacy = await opportunityLegacyAsText(input.name, input.bytes).catch(error => { throw error instanceof DocumentFileError ? new AuthError(error.message, 422) : error; });
  if (legacy) input = { ...input, ...legacy };
  const name = input.name.replace(/[\u0000-\u001f\\/]/g, '_').slice(0, 300);
  const mime = opportunityMime(name);
  if (!mime) throw new AuthError(`«${name.slice(0, 120)}»: usa PDF, Word, Excel o texto.`, 400);
  const sha = createHash('sha256').update(input.bytes).digest('hex');
  const existing = opportunityDb(await client.from('opportunity_documents').select('id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('sha256', sha).maybeSingle());
  if (existing) return existing.id;
  const count = await client.from('opportunity_documents').select('id', { head: true, count: 'exact' }).eq('organization_id', scope.organizationId).eq('opportunity_id', id);
  opportunityDb(count);
  if ((count.count || 0) >= 40) throw new AuthError('El expediente admite hasta 40 documentos por versión de trabajo.', 413);
  const docId = randomUUID(); const storagePath = `${scope.organizationId}/${id}/${docId}/${opportunityStorageName(name)}`;
  const stored = await client.storage.from(OPPORTUNITY_BUCKET).upload(storagePath, input.bytes, { contentType: mime, upsert: false });
  if (stored.error) throw new AuthError(`No pudimos guardar «${name.slice(0, 120)}». Intenta de nuevo en un momento.`, 503);
  let extracted: ExtractedOpportunityFile;
  try { extracted = await extractOpportunityFile(name, input.bytes); }
  catch { extracted = { status: 'damaged', total: null, read: 0, sections: [] }; }
  const chunks = opportunityTextChunks(extracted.sections);
  if (chunks.length > 1500) { chunks.splice(1500); extracted.status = 'partial'; }
  const row = await client.from('opportunity_documents').insert({ id: docId, organization_id: scope.organizationId, opportunity_id: id, name, mime, sha256: sha, storage_path: storagePath,
    source_url: input.sourceUrl || null, source_kind: input.sourceKind, bytes: input.bytes.length, pages_total: extracted.total, pages_read: extracted.read, extraction_status: 'pending', uploaded_by: scope.userId });
  if (row.error?.code === '23505') { await client.storage.from(OPPORTUNITY_BUCKET).remove([storagePath]); const found = opportunityDb(await client.from('opportunity_documents').select('id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('sha256', sha).single()); if (!found) throw new AuthError('No se pudo recuperar el documento.', 503); return found.id; }
  if (row.error) { await client.storage.from(OPPORTUNITY_BUCKET).remove([storagePath]); opportunityDb(row); }
  try {
    if (chunks.length) opportunityDb(await client.from('opportunity_document_chunks').insert(chunks.map(chunk => ({ ...chunk, document_id: docId, organization_id: scope.organizationId, opportunity_id: id }))));
    opportunityDb(await client.from('opportunity_documents').update({ extraction_status: extracted.status }).eq('id', docId).eq('organization_id', scope.organizationId).eq('opportunity_id', id));
  } catch (error) {
    await client.from('opportunity_documents').update({ extraction_status: 'partial' }).eq('id', docId).eq('organization_id', scope.organizationId);
    throw error;
  }
  return docId;
}
