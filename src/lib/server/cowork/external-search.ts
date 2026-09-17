import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { checkAndConsumeDailyQuota, getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { requestApolloSearch } from '@/lib/server/apollo-search-client';
import { requireCoworkWorkerAccess } from './access';
import { coworkApolloPayload, coworkSearchCriteriaSchema } from '@/lib/cowork/search-proposal';
import { deterministicCoworkUuid } from './operations';

const providerLead = z.object({ id: z.string().min(1).max(200) }).passthrough();
function text(value: unknown, max = 500) { return typeof value === 'string' ? value.slice(0, max) : null; }
function webUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function normalizeCoworkSearchResult(value: unknown, limit: number) {
  const payload = z.object({ leads: z.array(providerLead).max(1000) }).parse(value);
  return {
    scope: 'external_search', provider: 'apollo', limit,
    returned: Math.min(payload.leads.length, limit), truncated: payload.leads.length >= limit,
    items: payload.leads.slice(0, limit).map(lead => {
      const organization = lead.organization && typeof lead.organization === 'object' ? lead.organization as Record<string, unknown> : {};
      return {
        id: `apollo:${lead.id}`, name: text(lead.name || lead.full_name), title: text(lead.title),
        company: text(organization.name || lead.org_name || lead.organization_name),
        linkedin_url: webUrl(lead.linkedin_url),
        company_website: webUrl(organization.website_url || lead.organization_website),
        company_linkedin: webUrl(organization.linkedin_url),
        // Search does not reveal or verify mailbox addresses.
        email: null, status: 'No guardado', industry: text(organization.industry || lead.industry),
        location: [lead.city, lead.country].filter(item => typeof item === 'string').join(', ').slice(0, 500),
      };
    }),
  };
}

export async function resolveCoworkSearch(auth: AuthContext, runId: string, approve: boolean) {
  if (process.env.COWORK_EXTERNAL_SEARCH_ENABLED !== 'true' && approve) throw new Error('External search disabled');
  const client = getSupabaseAdminClient();
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  await requireCoworkWorkerAccess(client, scope);
  const args = { p_run_id: runId, p_user_id: scope.userId, p_organization_id: scope.organizationId };
  const claim = await client.rpc('cowork_claim_search', { ...args, p_approve: approve });
  if (claim.error) throw claim.error;
  return Boolean(claim.data);
}

/** Admit one child run resuming from the completed search result.
 * Best-effort: the search already finished durably, so a continuation failure
 * must never fail it. The deterministic request id collapses retries. */
export async function admitSearchContinuation(
  client: ReturnType<typeof getSupabaseAdminClient>,
  scope: { userId: string; organizationId: string },
  runId: string,
): Promise<string | null> {
  try {
    await requireCoworkWorkerAccess(client, scope);
    const parent = await client.from('cowork_runs').select('mode').eq('id', runId)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).single();
    if (parent.error || !parent.data) return null;
    const mode = parent.data.mode === 'autonomous' ? 'autonomous' : 'approval';
    const { data, error } = await client.rpc('cowork_admit_followup', {
      p_user_id: scope.userId, p_organization_id: scope.organizationId,
      p_request_id: deterministicCoworkUuid(`cowork:search-continuation:${runId}`),
      p_message: 'Continúa a partir del resultado de búsqueda completado del trabajo anterior, dentro del mismo encargo. Presenta los contactos encontrados y propón el siguiente paso concreto, por ejemplo guardar los adecuados. No repitas la búsqueda externa: ya está completada y su resultado está en el historial.',
      p_mode: mode, p_parent_run_id: runId,
    });
    if (error || typeof data !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}
/** Only the scheduled worker consumes quota/calls Apollo. Claims are never replayed. */
export async function processCoworkSearchQueue() {
  if (process.env.COWORK_ENABLED !== 'true' || process.env.COWORK_EXTERNAL_SEARCH_ENABLED !== 'true') return { processed: 0, claimed: false };
  const client = getSupabaseAdminClient();
  const claim = await client.rpc('cowork_take_search', { p_user_id: process.env.COWORK_OWNER_USER_ID });
  if (claim.error) throw claim.error;
  const job = claim.data?.[0];
  if (!job) return { processed: 0, claimed: false };
  const scope = { userId: job.user_id, organizationId: job.organization_id };
  const runId = job.run_id;
  const args = { p_run_id: runId, p_user_id: scope.userId, p_organization_id: scope.organizationId };
  try {
    const criteria = coworkSearchCriteriaSchema.parse(job.criteria);
    await requireCoworkWorkerAccess(client, scope);
    const beforeQuota = await client.from('cowork_runs').select('status').eq('id', runId).single();
    if (beforeQuota.error || beforeQuota.data.status !== 'waiting_approval') throw new Error('Search cancelled');
    const limits = await getEffectiveDailyQuotaLimits({ userId: scope.userId, organizationId: scope.organizationId });
    const quota = await checkAndConsumeDailyQuota({ userId: scope.userId, organizationId: scope.organizationId, resource: 'search', limit: limits.leadSearch });
    if (!quota.allowed) throw new Error('Search quota exhausted');
    await requireCoworkWorkerAccess(client, scope);
    const current = await client.from('cowork_runs').select('status').eq('id', runId).single();
    if (current.error || current.data.status !== 'waiting_approval') throw new Error('Search cancelled');
    const result = normalizeCoworkSearchResult(await requestApolloSearch(coworkApolloPayload(criteria, scope.userId)), criteria.limit);
    await requireCoworkWorkerAccess(client, scope);
    const finished = await client.rpc('cowork_finish_search', { ...args, p_success: true,
      p_payload: { action: 'prospecting.search', input: criteria, result } });
    if (finished.error) throw finished.error;
    if (finished.data === true) await admitSearchContinuation(client, scope, runId);
    return { processed: finished.data === true ? 1 : 0, claimed: true };
  } catch {
    const failed = await client.rpc('cowork_finish_search', { ...args, p_success: false, p_payload: {} });
    if (failed.error) throw failed.error;
    return { processed: 0, claimed: true };
  }
}
