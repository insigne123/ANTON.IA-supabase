import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contactRecordEvidence } from '@/lib/cowork/contact-evidence';
import { buildSupliaContext } from '@/lib/server/suplia-context';
import { getCurrentNativeDraft } from '@/lib/server/native-drafts';
import { hashMessagingDraftContent } from '@/lib/messaging-contracts';

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
): Promise<{ scope: string; period: string; savedContacts: number; contactedTotal: number; contactedThisWeek: number; repliesThisWeek: number }>;
export async function queryCoworkExtendedReads(
  client: SupabaseClient, scope: Scope, action: 'app.context', value: string,
): Promise<{ scope: string; emailConnections: { google: boolean; outlook: boolean }; counts: Record<string, number>; performance: unknown; offer: string | null }>;
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
  | { scope: string; period: string; savedContacts: number; contactedTotal: number; contactedThisWeek: number; repliesThisWeek: number }
  | { scope: string; emailConnections: { google: boolean; outlook: boolean }; counts: Record<string, number>; performance: unknown; offer: string | null }
  | { scope: string; draftId: string; versionId: string; revision: number; channel: string; subject: string | null; contentHash: string; recipientEmail: string | null; recipientName: string | null; lifecycle: string; textLength: number }
  | { scope: string; campaigns: Array<{ id: string; name: string; status: string; revision: number; recipients: number; createdAt: string }> }
  | { scope: string; files: Array<{ name: string; size: number; updatedAt: string }> }
> {
  if (action === 'metrics.overview') return readCoworkMetrics(client, scope);
  if (action === 'app.context') return readCoworkAppContext(scope);
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
    return { items: data || [], returned: data?.length || 0, limit: 20, scope: 'organization_contacted', truncated: (data?.length || 0) >= 20,
      evidence: { source: 'application_contact_records', queriedAt: new Date().toISOString(),
        mailboxSyncedAt: null, mailboxCoverageComplete: false, pendingStatus: 'needs_verification',
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
  return { contacted: rows, scope: 'organization_contacted', truncated: rows.length >= 15, ...evidence };
}

async function readCoworkMetrics(client: SupabaseClient, scope: Scope) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const org = scope.organizationId;
  const [leads, contacted, contactedWeek, repliesWeek] = await Promise.all([
    client.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', org),
    client.from('contacted_leads').select('id', { count: 'exact', head: true }).eq('organization_id', org),
    client.from('contacted_leads').select('id', { count: 'exact', head: true }).eq('organization_id', org).gte('sent_at', since),
    client.from('contacted_leads').select('id', { count: 'exact', head: true }).eq('organization_id', org).gte('replied_at', since),
  ]);
  const failed = [leads, contacted, contactedWeek, repliesWeek].find(result => result.error)?.error;
  if (failed) throw new Error('No se pudieron calcular las métricas.');
  const count = (result: { count?: number | null } | null) => Number(result?.count || 0);
  return {
    scope: 'organization_metrics', period: 'last_7_days',
    savedContacts: count(leads), contactedTotal: count(contacted),
    contactedThisWeek: count(contactedWeek), repliesThisWeek: count(repliesWeek),
  };
}

export async function readCoworkAppContext(scope: Scope, builder = buildSupliaContext) {  // Reuses the shared context builder (connections, counts, offer): Cowork needs
  // the same verified connection state before discussing sends. No tokens included.
  const context = await builder({ user: { id: scope.userId }, organizationId: scope.organizationId, organizationIds: [scope.organizationId], supabase: null } as never);
  return {
    scope: 'organization_context',
    emailConnections: context.emailConnections, counts: context.counts,
    performance: context.performance, offer: context.offer,
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
export async function readCoworkCampaigns(client: SupabaseClient, scope: Scope) {
  const { data, error } = await client.from('bulk_campaigns')
    .select('id,definition,status,revision,recipients,created_at')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('created_at', { ascending: false }).limit(20);
  if (error) throw new Error('No se pudieron consultar las campañas.');
  return {
    scope: 'own_campaigns',
    campaigns: (data || []).map((row: { id: string; definition: { name?: string }; status: string; revision: number; recipients?: unknown[]; created_at: string }) => ({
      id: row.id, name: row.definition?.name || 'Campaña', status: row.status, revision: row.revision,
      recipients: Array.isArray(row.recipients) ? row.recipients.length : 0, createdAt: row.created_at,
    })),
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
