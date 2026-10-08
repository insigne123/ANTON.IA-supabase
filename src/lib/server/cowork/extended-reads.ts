import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contactRecordEvidence } from '@/lib/cowork/contact-evidence';
import { readMailboxCoverage } from './reply-reads';
import { buildSupliaContext, readOrganizationOffer } from '@/lib/server/suplia-context';
import { getCurrentNativeDraft } from '@/lib/server/native-drafts';
import { hashMessagingDraftContent } from '@/lib/messaging-contracts';
import {
  COWORK_FILE_NOTICE, COWORK_FILE_UNREADABLE, coworkDecodeFile, coworkFileKind, coworkFileMissing, coworkFilePreview, coworkFilesByWords,
} from '@/lib/cowork/file-read';
import { COWORK_UPLOAD_BUCKET, listCoworkUploads } from './uploads';
import { coworkBinaryPreview } from './file-binary';

type Scope = { userId: string; organizationId: string };

/** Fase 2A: team-scoped reads (CRM, contacted history, metrics, app context).
 * Unlike leads.search (own records only), these intentionally cover the whole
 * active organization so Cowork can answer about team pipeline state.
 * Every result carries its scope label; outputs are capped and minimized. */
function searchTerm(value: string, max = 120) {
  const term = z.string().max(max).parse(value).replace(/[^\p{L}\p{N}\s@.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (value.trim() && !term) throw new Error('Invalid search term');
  return term;
}

export type CoworkExtendedReadAction =
  'crm.search' | 'crm.get_lead' | 'contacted.search' | 'contacted.timeline' | 'metrics.overview' | 'app.context' | 'draft.get' | 'campaigns.list' | 'files.list';

export async function queryCoworkExtendedReads(
  client: SupabaseClient, scope: Scope, action: 'crm.search' | 'contacted.search', value: string,
): Promise<{ items: unknown[]; returned: number; limit: number; scope: string; truncated: boolean }>;
export async function queryCoworkExtendedReads(
  client: SupabaseClient, scope: Scope, action: 'crm.get_lead', value: string,
): Promise<{ lead: unknown; contacted: unknown[]; scope: string }>;
export async function queryCoworkExtendedReads(
  client: SupabaseClient, scope: Scope, action: 'contacted.timeline', value: string,
): Promise<{ contacted: unknown[]; scope: string; truncated: boolean } & ReturnType<typeof contactRecordEvidence>>;
export async function queryCoworkExtendedReads(
  client: SupabaseClient, scope: Scope, action: 'metrics.overview', value: string,
): Promise<{ scope: string; period: string; savedContacts: number; contactedTotal: number; contactedThisWeek: number; repliesThisWeek: number; autoRepliesThisWeek: number; bouncesThisWeek: number }>;
export async function queryCoworkExtendedReads(
  client: SupabaseClient, scope: Scope, action: 'app.context', value: string,
): Promise<{ scope: string; emailConnections: { google: boolean; outlook: boolean }; counts: Record<string, number>; performance: unknown; offer: string | null; offerSource?: string | null }>;
export async function queryCoworkExtendedReads(
  client: SupabaseClient, scope: Scope, action: 'draft.get', value: string,
): Promise<{ scope: string; draftId: string; versionId: string; revision: number; channel: string; subject: string | null; contentHash: string; recipientEmail: string | null; recipientName: string | null; lifecycle: string; textLength: number }>;
export async function queryCoworkExtendedReads(
  client: SupabaseClient, scope: Scope, action: 'campaigns.list', value: string,
): Promise<{ scope: string; campaigns: Array<{ id: string; name: string; status: string; revision: number; recipients: number; createdAt: string }> }>;
export async function queryCoworkExtendedReads(
  client: SupabaseClient, scope: Scope, action: 'files.list', value: string,
): Promise<{ scope: string; files: Array<{ name: string; runId: string; size: number; updatedAt: string }> }>;
export async function queryCoworkExtendedReads(
  client: SupabaseClient, scope: Scope, action: CoworkExtendedReadAction, value: string,
): Promise<unknown>;
export async function queryCoworkExtendedReads(
  client: SupabaseClient,
  scope: Scope,
  action: CoworkExtendedReadAction,
  value: string,
): Promise<
  | { items: unknown[]; returned: number; limit: number; scope: string; truncated: boolean; evidence?: unknown }
  | { lead: unknown; contacted: unknown[]; scope: string }
  | { contacted: unknown[]; scope: string; truncated: boolean; turn: unknown }
  | { scope: string; period: string; savedContacts: number; contactedTotal: number; contactedThisWeek: number; repliesThisWeek: number; autoRepliesThisWeek: number; bouncesThisWeek: number }
  | { scope: string; emailConnections: { google: boolean; outlook: boolean }; counts: Record<string, number>; performance: unknown; offer: string | null; offerSource?: string | null }
  | { scope: string; draftId: string; versionId: string; revision: number; channel: string; subject: string | null; contentHash: string; recipientEmail: string | null; recipientName: string | null; lifecycle: string; textLength: number }
  | { scope: string; campaigns: Array<{ id: string; name: string; status: string; revision: number; recipients: number; createdAt: string }> }
  | { scope: string; files: Array<{ name: string; size: number; updatedAt: string }> }
> {
  if (action === 'metrics.overview') return readCoworkMetrics(client, scope);
  if (action === 'app.context') return readCoworkAppContext(scope, buildSupliaContext, client);
  if (action === 'draft.get') return readCoworkDraft(scope, value);
  if (action === 'campaigns.list') return readCoworkCampaigns(client, scope);
  if (action === 'files.list') return readCoworkFiles(client, scope);
  if (action === 'crm.search') {
    const term = searchTerm(value);
    let query = client.from('leads')
      .select('id,name,title,company,email,status,industry,location,created_at')
      .eq('organization_id', scope.organizationId)
      .order('created_at', { ascending: false }).limit(20);
    if (term) query = query.or(`name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%,title.ilike.%${term}%`);
    const { data, error } = await query;
    if (error) throw new Error('No se pudo consultar el CRM.');
    return { items: data || [], returned: data?.length || 0, limit: 20, scope: 'organization_crm', truncated: (data?.length || 0) >= 20 };
  }
  if (action === 'crm.get_lead') {
    const leadId = z.string().uuid().parse(value);
    const { data: lead, error } = await client.from('leads')
      .select('id,name,title,company,email,status,industry,company_website,company_linkedin,linkedin_url,location,created_at')
      .eq('organization_id', scope.organizationId).eq('id', leadId).maybeSingle();
    if (error) throw new Error('No se pudo leer la ficha del contacto.');
    if (!lead) return { lead: null, contacted: [], scope: 'organization_crm' };
    const { data: contacted, error: contactedError } = await client.from('contacted_leads')
      .select('id,name,email,company,status,provider,subject,sent_at,replied_at,reply_intent')
      .eq('organization_id', scope.organizationId).eq('lead_id', lead.id)
      .order('sent_at', { ascending: false }).limit(10);
    if (contactedError) throw new Error('No se pudo leer el historial del contacto.');
    return { lead, contacted: contacted || [], scope: 'organization_crm' };
  }
  if (action === 'contacted.search') {
    const term = searchTerm(value);
    let query = client.from('contacted_leads')
      .select('id,lead_id,name,email,company,status,provider,subject,sent_at,replied_at,reply_intent')
      .eq('organization_id', scope.organizationId)
      .order('sent_at', { ascending: false }).limit(20);
    if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%,subject.ilike.%${term}%`);
    const { data, error } = await query;
    if (error) throw new Error('No se pudieron consultar los contactados.');
    const coverage = await readMailboxCoverage(client, scope);
    return { items: data || [], returned: data?.length || 0, limit: 20, scope: 'organization_contacted', truncated: (data?.length || 0) >= 20,
      evidence: { source: 'application_contact_records', queriedAt: new Date().toISOString(),
        mailboxSyncedAt: coverage.gmail?.lastCompletedAt || coverage.outlook?.lastCompletedAt || null,
        mailboxCoverage: coverage, pendingStatus: 'needs_verification',
        nextRead: 'contacted.timeline', limitation: 'Lista de registros, no cola de respuestas pendientes confirmadas.' } };
  }
  const leadId = z.string().uuid().parse(value);
  const { data: contacted, error } = await client.from('contacted_leads')
    .select('id,lead_id,name,email,company,status,provider,subject,sent_at,replied_at,reply_summary,reply_intent,bounced_at,delivery_status')
    .eq('organization_id', scope.organizationId).eq('lead_id', leadId)
    .order('sent_at', { ascending: false }).limit(15);
  if (error) throw new Error('No se pudo leer el historial de envíos.');
  const rows = (contacted || []) as Array<{ id: string; sent_at?: string | null; replied_at?: string | null; reply_intent?: string | null }>;
  const now = new Date().toISOString();
  const evidence = contactRecordEvidence(rows, rows.length >= 15, now);
  const coverage = await readMailboxCoverage(client, scope);
  const sweep = { mailboxCoverage: coverage, mailboxSyncedAt: coverage.gmail?.lastCompletedAt || coverage.outlook?.lastCompletedAt || null };
  return { contacted: rows, scope: 'organization_contacted', truncated: rows.length >= 15, ...evidence, ...sweep };
}

async function readCoworkMetrics(client: SupabaseClient, scope: Scope) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const org = scope.organizationId;
  const repliedThisWeek = () => client.from('contacted_leads')
    .select('id', { count: 'exact', head: true }).eq('organization_id', org).gte('replied_at', since);
  const [leads, contacted, contactedWeek, humanReplies, autoReplies, bounces] = await Promise.all([
    client.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', org),
    client.from('contacted_leads').select('id', { count: 'exact', head: true }).eq('organization_id', org),
    client.from('contacted_leads').select('id', { count: 'exact', head: true }).eq('organization_id', org).gte('sent_at', since),
    repliedThisWeek().not('reply_intent', 'in', '(auto_reply,delivery_failure)'),
    repliedThisWeek().eq('reply_intent', 'auto_reply'),
    repliedThisWeek().eq('reply_intent', 'delivery_failure'),
  ]);
  const failed = [leads, contacted, contactedWeek, humanReplies, autoReplies, bounces].find(result => result.error)?.error;
  if (failed) throw new Error('No se pudieron calcular las métricas.');
  const count = (result: { count?: number | null } | null) => Number(result?.count || 0);
  return {
    scope: 'organization_metrics', period: 'last_7_days',
    savedContacts: count(leads), contactedTotal: count(contacted),
    contactedThisWeek: count(contactedWeek),
    // Human replies only: automatic and bounce intents ride separately so the
    // response rate never inflates with out-of-office noise (stage 6.2).
    repliesThisWeek: count(humanReplies),
    autoRepliesThisWeek: count(autoReplies), bouncesThisWeek: count(bounces),
  };
}

export { readOrganizationOffer };

export async function readCoworkAppContext(scope: Scope, builder = buildSupliaContext, client?: SupabaseClient) {  // Reuses the shared context builder (connections, counts, offer): Cowork needs
  // the same verified connection state before discussing sends. No tokens included.
  const context = await builder({ user: { id: scope.userId }, organizationId: scope.organizationId, organizationIds: [scope.organizationId], supabase: null } as never);
  const organizationOffer = context.offer ? null : await readOrganizationOffer(client, scope.organizationId);
  return {
    scope: 'organization_context',
    emailConnections: context.emailConnections, counts: context.counts,
    performance: context.performance,
    offer: context.offer || organizationOffer,
    offerSource: context.offer ? 'profile' : organizationOffer ? 'organization' : null,
  };
}

/** Latest native draft version with its content hash: the observation the
 * send effect must reference. Full body stays out of observations; the review
 * card loads it through the scoped preview route. */
export async function readCoworkDraft(scope: Scope, value: string) {  const draftId = z.string().uuid().parse(value);
  const draft = await getCurrentNativeDraft({ userId: scope.userId, organizationId: scope.organizationId, draftId });
  if (!draft) throw new Error('El borrador ya no está disponible.');
  return {
    scope: 'own_draft', draftId: draft.draftId, versionId: draft.versionId, revision: draft.revision,
    channel: draft.channel, subject: draft.content.subject,
    contentHash: hashMessagingDraftContent(draft),
    recipientEmail: draft.recipient.email, recipientName: draft.recipient.displayName,
    lifecycle: draft.lifecycle, textLength: (draft.content.text || '').length,
  };
}

/** Own bulk campaigns with recipient counts: the observation activate/pause
 * effects must reference. Full definitions stay out of observations. */
const CAMPAIGNS_LISTED = 20;

/** The person's 20 most recent campaigns, and how many there are in all: with more than 20, «tienes 20 campañas» would be wrong
 * (Plan 15). total is null when the count could not be read. */
export async function readCoworkCampaigns(client: SupabaseClient, scope: Scope) {
  const { data, error, count } = await client.from('bulk_campaigns')
    .select('id,definition,status,revision,recipients,created_at', { count: 'exact' })
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('created_at', { ascending: false }).limit(CAMPAIGNS_LISTED);
  if (error) throw new Error('No se pudieron consultar las campañas.');
  const campaigns = (data || []).map((row: { id: string; definition: { name?: string }; status: string; revision: number; recipients?: unknown[]; created_at: string }) => ({
    id: row.id, name: row.definition?.name || 'Campaña', status: row.status, revision: row.revision,
    recipients: Array.isArray(row.recipients) ? row.recipients.length : 0, createdAt: row.created_at,
  }));
  const total = typeof count === 'number' ? count : null;
  return {
    scope: 'own_campaigns',
    campaigns,
    returned: campaigns.length,
    total,
    truncated: total === null ? campaigns.length >= CAMPAIGNS_LISTED : total > campaigns.length,
  };
}

/** Files uploaded for code execution, listed across this user's run prefixes.
 * Contents stay out of observations; execution downloads exactly the approved
 * names from the proposing run's prefix. */
export async function readCoworkFiles(client: SupabaseClient, scope: Scope) {
  const { data, error } = await client.storage.from('cowork-uploads')
    .list(`${scope.organizationId}/${scope.userId}`, { limit: 100 });
  if (error) throw new Error('No se pudieron listar los archivos.');
  const files: Array<{ name: string; runId: string; size: number; updatedAt: string }> = [];
  for (const run of data || []) {
    if (!run.name) continue;
    const { data: names, error: runError } = await client.storage.from('cowork-uploads')
      .list(`${scope.organizationId}/${scope.userId}/${run.name}`, { limit: 50 });
    if (runError) continue;
    for (const file of names || []) {
      if (!file.name) continue;
      files.push({ name: file.name, runId: run.name, size: Number(file.metadata?.size || 0),
        updatedAt: String(file.updated_at || file.created_at || '') });
    }
    if (files.length >= 40) break;
  }
  return { scope: 'own_uploads', files: files.slice(0, 40) };
}

const MAX_READ_BYTES = 20 * 1024 * 1024;

/** An upload a name points to, as the person's files are searched for it. */
export type CoworkUploadMatch = { name: string; sheet: string; runId: string; size: number };

/**
 * Which of this user's own uploads a name points to: the name itself or words of it («feria» when only
 * one upload has that word); the most recent when the name repeats. «archivo.xlsx#Hoja» also names a
 * sheet. When no single upload matches, what there is to say about it (coworkFileMissing).
 */
export async function findCoworkUpload(client: SupabaseClient, scope: Scope, value: string)
  : Promise<{ found: true; upload: CoworkUploadMatch } | { found: false; missing: ReturnType<typeof coworkFileMissing> }> {
  const asked = z.string().trim().min(1).max(160).parse(value).toLowerCase();
  if (/[\\/\0]/.test(asked) || asked.startsWith('.')) throw new Error('Nombre de archivo inválido.');
  const uploads = await listCoworkUploads(client, scope);
  // «archivo.xlsx#Hoja 2»: unless a whole upload has that name, what follows the last # is the sheet.
  const hash = asked.lastIndexOf('#');
  const split = hash > 0 && !uploads.has(asked) ? { file: asked.slice(0, hash).trim(), sheet: asked.slice(hash + 1).trim() } : { file: asked, sheet: '' };
  const byWords = uploads.has(split.file) ? [] : coworkFilesByWords(split.file, [...uploads.keys()]);
  const name = uploads.has(split.file) ? split.file : byWords.length === 1 ? byWords[0] : null;
  if (!name) return { found: false, missing: coworkFileMissing(split.file, [...uploads.keys()], byWords) };
  const match = (uploads.get(name) || [])[0];
  return { found: true, upload: { name, sheet: split.sheet, runId: match.runId, size: match.size } };
}

/** The bytes of an upload, within the 20 MB Cowork reads. */
export async function downloadCoworkUpload(client: SupabaseClient, scope: Scope, upload: CoworkUploadMatch) {
  if (upload.size > MAX_READ_BYTES) throw new Error('El archivo supera 20 MB.');
  const { data, error } = await client.storage.from(COWORK_UPLOAD_BUCKET)
    .download(`${scope.organizationId}/${scope.userId}/${upload.runId}/${upload.name}`);
  if (error || !data) throw new Error('No se pudo leer el archivo.');
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length > MAX_READ_BYTES) throw new Error('El archivo supera 20 MB.');
  return bytes;
}

/** One uploaded file from this user's own uploads, by its name or by words of
 * it («feria» when only one upload has that word); the most recent when the name
 * repeats. CSV, JSON, Markdown, text, Excel (.xlsx), PDF and Word (.docx) are read, trimmed
 * to what the model can use in one decision; nothing is executed. An Excel sheet other than the
 * first is asked for as «archivo.xlsx#Hoja». */
export async function readCoworkFileContent(client: SupabaseClient, scope: Scope, value: string) {
  const found = await findCoworkUpload(client, scope, value);
  if (!found.found) return found.missing;
  const { upload } = found;
  const { name } = upload;
  const base = { scope: 'own_uploads', found: true, name, runId: upload.runId, size: upload.size };
  const kind = coworkFileKind(name);
  if (kind === 'other') return { ...base, kind: 'unreadable', message: COWORK_FILE_UNREADABLE.other };
  // An Excel from before 2007 is not opened: no need to download it to say so.
  if (kind === 'excel' && !name.endsWith('.xlsx')) return { ...base, kind: 'unreadable', message: COWORK_FILE_UNREADABLE.xls };
  const bytes = await downloadCoworkUpload(client, scope, upload);
  // Excel, PDF and Word are opened here; the rest is text.
  const opened = await coworkBinaryPreview(name, bytes, { sheet: upload.sheet });
  if (opened) {
    return 'unreadable' in opened
      ? { ...base, kind: 'unreadable', message: COWORK_FILE_UNREADABLE[opened.unreadable] }
      : { ...base, ...opened.preview, notice: COWORK_FILE_NOTICE };
  }
  const preview = coworkFilePreview(name, coworkDecodeFile(bytes));
  if (!preview) return { ...base, kind: 'unreadable', message: COWORK_FILE_UNREADABLE.other };
  return { ...base, ...preview, notice: COWORK_FILE_NOTICE };
}
