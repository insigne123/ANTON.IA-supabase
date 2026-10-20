import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { OPPORTUNITY_BUCKET } from '@/lib/commercial-opportunities/workspace';
import { SCAN_GROUP, SCAN_IMAGE_TOKENS, SCAN_PAGE_TOKENS, scanAnswerSchema, scanGroups, scanLocator, scanPrompt, scanSections } from '@/lib/commercial-opportunities/document-scans';
import { opportunityDb } from './workspace-store';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';
import { opportunityTextChunks } from './document-files';

/** Scan jobs still at work on an opportunity's documents: its report waits for them (workspace-research.ts). */
export async function activeDocumentScans(client: SupabaseClient, organizationId: string, opportunityId: string) {
  const rows = opportunityDb(await client.from('opportunity_jobs').select('id').eq('organization_id', organizationId).eq('opportunity_id', opportunityId)
    .eq('kind', 'evaluate').like('dedupe_key', 'scan:%').in('state', ['queued', 'running', 'waiting']).limit(1));
  return (rows || []).length > 0;
}

/**
 * Reads an image or the pages without text of a PDF (document-scans.ts), a group of pages per call, and saves their text as
 * the document's fragments. A job that runs out of time keeps the pages it read and resumes on the next tick, where the
 * groups already paid for come back from their results.
 */
export async function runDocumentScan(client: SupabaseClient, job: OpportunityJob, started = Date.now()) {
  const doc = opportunityDb(await client.from('opportunity_documents').select('id,name,mime,storage_path,extraction_status,pages_total')
    .eq('organization_id', job.organization_id).eq('opportunity_id', job.opportunity_id).eq('id', job.payload.documentId).maybeSingle());
  // Deleted meanwhile, or already read by an earlier job.
  if (!doc || !['scan', 'partial'].includes(doc.extraction_status)) return { pages: 0 };
  const image = String(doc.mime).startsWith('image/');
  const pages = (Array.isArray(job.payload.pages) ? job.payload.pages : []).filter((page: unknown) => Number.isInteger(page)) as number[];
  const done = new Set<number>(job.payload.done || []); const missing = new Set<number>(job.payload.missing || []);
  const groups = scanGroups(pages.filter(page => !done.has(page)));
  if (groups.length) {
    const file = await client.storage.from(OPPORTUNITY_BUCKET).download(doc.storage_path);
    if (file.error || !file.data) throw new AuthError('No pudimos abrir el documento guardado.', 503);
    const attachment = { kind: image ? 'image' as const : 'pdf' as const, mediaType: doc.mime, data: Buffer.from(await file.data.arrayBuffer()).toString('base64') };
    for (const group of groups) {
      // The next call takes up to 110 s, inside the tick's 300 s.
      if (Date.now() - started > 100_000) return { waiting: true as const };
      let answer;
      // One group the model could not answer (a malformed or unfinished call) leaves its pages unread, not the whole document.
      try { answer = await opportunityGenerate(client, job, { step: `scan:${doc.id}:${group.join(',')}`, category: 'research', role: 'extract', schema: scanAnswerSchema,
        output: image ? 3000 : 1100 * group.length + 500, prompt: scanPrompt({ name: doc.name, image, pages: group }),
        attachments: [attachment], attachmentTokens: image ? SCAN_IMAGE_TOKENS : (doc.pages_total || SCAN_GROUP) * SCAN_PAGE_TOKENS }); }
      catch (error) {
        if (!(error instanceof AuthError) || error.status !== 503 || /no está conectado|no lee/i.test(error.message)) throw error;
        answer = { pages: [] };
      }
      const read = scanSections(answer, group, image);
      await saveScanChunks(client, job, doc.id, group, image, read.sections);
      for (const page of group) { done.add(page); if (read.missing.includes(page)) missing.add(page); else missing.delete(page); }
      job.payload.done = [...done]; job.payload.missing = [...missing];
      const kept = opportunityDb(await client.from('opportunity_jobs').update({ payload: job.payload }).eq('id', job.id).eq('lease_token', job.lease_token).select('id').maybeSingle());
      if (!kept) throw new AuthError('El trabajo se retomó en otro proceso.', 409);
    }
  }
  const pagesRead = done.size - missing.size;
  // Nothing came back: the document keeps the status it had, and the report says so.
  if (!pagesRead) return { pages: 0, status: doc.extraction_status };
  const status = missing.size ? 'partial' : 'read';
  opportunityDb(await client.from('opportunity_documents').update({ extraction_status: status, ...(doc.pages_total ? { pages_read: doc.pages_total - missing.size } : {}) })
    .eq('organization_id', job.organization_id).eq('opportunity_id', job.opportunity_id).eq('id', doc.id));
  return { pages: pagesRead, status };
}

/** A group's text, replacing what an interrupted run of the same group may have left; after the document's own fragments. */
async function saveScanChunks(client: SupabaseClient, job: OpportunityJob, documentId: string, group: number[], image: boolean, sections: Array<{ locator: string; text: string }>) {
  const scoped = () => client.from('opportunity_document_chunks').select('ordinal').eq('organization_id', job.organization_id).eq('opportunity_id', job.opportunity_id).eq('document_id', documentId);
  // A page's text is up to 12,000 characters: two fragments of 6,000 (opportunityTextChunks).
  const locators = group.flatMap(page => [scanLocator(image, page), ...[1, 2].map(block => `${scanLocator(image, page)} · bloque ${block}`)]);
  opportunityDb(await client.from('opportunity_document_chunks').delete().eq('organization_id', job.organization_id).eq('opportunity_id', job.opportunity_id)
    .eq('document_id', documentId).in('locator', locators));
  if (!sections.length) return;
  const last = opportunityDb(await scoped().order('ordinal', { ascending: false }).limit(1).maybeSingle());
  const start = typeof last?.ordinal === 'number' ? last.ordinal + 1 : 0;
  opportunityDb(await client.from('opportunity_document_chunks').insert(opportunityTextChunks(sections).map(chunk => ({ ...chunk, ordinal: start + chunk.ordinal,
    document_id: documentId, organization_id: job.organization_id, opportunity_id: job.opportunity_id }))));
}
