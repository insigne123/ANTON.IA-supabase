import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { checkAndConsumeDailyQuota, getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { requestApolloSearch } from '@/lib/server/apollo-search-client';
import { requireCoworkWorkerAccess } from './access';
import {
  COWORK_SEARCH_COMPANIES, COWORK_SEARCH_COMPANY_GROUP, COWORK_SEARCH_MAX_OFFSET, COWORK_SEARCH_MAX_PAGE,
  coworkApolloPayload, coworkCompanyStepPayload, coworkPeopleStepPayload, coworkSearchCriteriaSchema, coworkSearchStrategy,
  type CoworkSearchCriteria,
} from '@/lib/cowork/search-proposal';
import { COWORK_SEARCH_ROLE_NOTE, rankCoworkSearchPeople } from '@/lib/cowork/search-ranking';
import { normalizeCompanyName } from '@/lib/cowork/commercial-facts';
import { admitCoworkContinuation } from './effects';
import { readTeamLocks } from '@/lib/server/team-locks';
import { normalizeLockLinkedin, teamLockNotice } from '@/lib/team-lock';
import type { AudienceRolePolicy } from '@/lib/cowork/audience-analysis';

const providerLead = z.object({ id: z.string().min(1).max(200) }).passthrough();
function text(value: unknown, max = 500) { return typeof value === 'string' ? value.slice(0, max) : null; }
function webUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function count(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null; }
function record(value: unknown) { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }

type ProviderRecord = z.infer<typeof providerLead>;
type Company = { id: string; name: string | null; website: string | null; linkedin: string | null; industry: string | null; employees: number | null };

function companyOf(org: ProviderRecord): Company {
  return { id: org.id, name: text(org.name), website: webUrl(org.website_url), linkedin: webUrl(org.linkedin_url),
    industry: text(org.industry), employees: count(org.estimated_num_employees) };
}

/** One person as Cowork shows and saves it; the company found first fills what the people search leaves out. */
function personRow(lead: ProviderRecord, company?: Company) {
  const organization = record(lead.organization);
  return {
    id: `apollo:${lead.id}`, name: text(lead.name || lead.full_name), title: text(lead.title),
    company: text(organization.name || lead.org_name || lead.organization_name) || company?.name || null,
    linkedin_url: webUrl(lead.linkedin_url),
    company_website: webUrl(organization.website_url || lead.organization_website) || company?.website || null,
    company_linkedin: webUrl(organization.linkedin_url) || company?.linkedin || null,
    // Search does not reveal or verify mailbox addresses.
    email: null, status: 'No guardado', industry: text(organization.industry || lead.industry) || company?.industry || null,
    employees: count(lead.organization_size) ?? company?.employees ?? null,
    location: [lead.city, lead.country].filter(item => typeof item === 'string').join(', ').slice(0, 500),
  };
}

/** Who belongs to the same company: its provider id, else its name. */
function companyKey(lead: ProviderRecord) {
  const organization = record(lead.organization);
  const id = text(organization.id, 200) || text(lead.organization_id, 200);
  if (id) return `id:${id}`;
  const name = normalizeCompanyName(String(organization.name || lead.organization_name || lead.org_name || ''));
  return name ? `name:${name}` : null;
}

/** The ranked rows without the key used to rank them. */
function rankedRows(rows: Array<ReturnType<typeof personRow> & { companyKey: string | null }>, options: Parameters<typeof rankCoworkSearchPeople>[1]) {
  const ranked = rankCoworkSearchPeople(rows, options);
  return { total: ranked.total, items: ranked.items.map(({ companyKey: _key, ...row }) => row) };
}

export function normalizeCoworkSearchResult(value: unknown, limit: number, target: 'people' | 'companies' = 'people', rolePolicy?: AudienceRolePolicy | null, page = 1) {
  if (target === 'companies') {
    const payload = z.object({ organizations: z.array(providerLead).max(1000) }).parse(value);
    const next = payload.organizations.length >= limit && page < COWORK_SEARCH_MAX_PAGE ? { page: page + 1 } : null;
    return { scope: 'external_company_search', provider: 'apollo', limit, page,
      returned: Math.min(payload.organizations.length, limit), truncated: Boolean(next), hasMore: Boolean(next), next,
      items: payload.organizations.slice(0, limit).map(org => ({
        id: `apollo-company:${org.id}`, name: text(org.name), domain: text(org.primary_domain),
        website: webUrl(org.website_url), linkedin_url: webUrl(org.linkedin_url),
        industry: text(org.industry), employees: typeof org.estimated_num_employees === 'number' ? org.estimated_num_employees : null,
        location: [org.city, org.country].filter(item => typeof item === 'string').join(', ').slice(0, 500),
      })), notice: 'Resultados del proveedor por palabras clave; confirma el encaje del sector. Son empresas, no contactos guardables como personas.' };
  }
  const payload = z.object({ leads: z.array(providerLead).max(1000) }).parse(value);
  const ranked = rankedRows(payload.leads.map(lead => ({ ...personRow(lead), companyKey: companyKey(lead) })), { rolePolicy, limit });
  const next = payload.leads.length >= limit && page < COWORK_SEARCH_MAX_PAGE ? { page: page + 1 } : null;
  return {
    scope: 'external_search', provider: 'apollo', strategy: 'people', limit, page,
    returned: ranked.items.length, truncated: Boolean(next), hasMore: Boolean(next), next,
    roleNote: COWORK_SEARCH_ROLE_NOTE, items: ranked.items,
  };
}

type SearchRequest = (payload: Record<string, unknown>) => Promise<unknown>;

/**
 * «Empresas primero»: the companies of the criteria (one provider search), then the people with those roles inside
 * them, 50 companies per call, ranked by who may decide the purchase. The page moves through companies; offset
 * through the people of those same companies, so «Traer más» brings new people before new companies.
 */
async function searchCompaniesFirst(criteria: CoworkSearchCriteria, userId: string, request: SearchRequest) {
  const page = criteria.page || 1;
  const offset = criteria.offset || 0;
  const found = z.object({ organizations: z.array(providerLead).max(1000), total_pages: z.number().nullish() }).passthrough()
    .parse(await request(coworkCompanyStepPayload(criteria, userId)));
  const companies = found.organizations.slice(0, COWORK_SEARCH_COMPANIES).map(companyOf);
  const base = { scope: 'external_search', provider: 'apollo', strategy: 'companies_first', limit: criteria.limit, page, offset,
    roleNote: COWORK_SEARCH_ROLE_NOTE };
  if (!companies.length) {
    return { ...base, returned: 0, truncated: false, hasMore: false, next: null, candidates: 0,
      companies: { found: 0, withPeople: 0 }, items: [],
      notice: page > 1 ? 'No hay más empresas con estos criterios.' : 'No encontré empresas con esos rubros y lugares. Prueba con otros rubros, sin tamaño de empresa o con otro país.' };
  }
  const byId = new Map(companies.map(company => [`id:${company.id}`, company]));
  const byName = new Map(companies.filter(company => company.name).map(company => [`name:${normalizeCompanyName(company.name!)}`, company]));
  const leads = new Map<string, ProviderRecord>();
  let failure: unknown = null;
  let answered = 0;
  for (let start = 0; start < companies.length; start += COWORK_SEARCH_COMPANY_GROUP) {
    const ids = companies.slice(start, start + COWORK_SEARCH_COMPANY_GROUP).map(company => company.id);
    try {
      const people = z.object({ leads: z.array(providerLead).max(1000) }).parse(await request(coworkPeopleStepPayload(criteria, userId, ids)));
      for (const lead of people.leads) if (!leads.has(lead.id)) leads.set(lead.id, lead);
      answered++;
    } catch (error) {
      failure ??= error;
    }
  }
  // Without any answer the search failed; with some, it says which part is missing.
  if (!answered) throw failure;
  const rows = [...leads.values()].map(lead => {
    const key = companyKey(lead);
    const company = key ? byId.get(key) || byName.get(key) : undefined;
    return { ...personRow(lead, company), companyKey: company ? `id:${company.id}` : key };
  });
  const ranked = rankedRows(rows, { rolePolicy: criteria.rolePolicy, limit: criteria.limit, offset,
    companyOrder: companies.map(company => `id:${company.id}`) });
  const moreCompanies = page < COWORK_SEARCH_MAX_PAGE
    && (typeof found.total_pages === 'number' ? found.total_pages > page : found.organizations.length >= COWORK_SEARCH_COMPANIES);
  const nextOffset = offset + criteria.limit;
  const next = nextOffset < ranked.total && nextOffset <= COWORK_SEARCH_MAX_OFFSET ? { page, offset: nextOffset }
    : moreCompanies ? { page: page + 1, offset: 0 } : null;
  return {
    ...base, returned: ranked.items.length, truncated: Boolean(next), hasMore: Boolean(next), next, candidates: ranked.total,
    companies: { found: companies.length, withPeople: new Set(rows.map(row => row.companyKey).filter(Boolean)).size },
    items: ranked.items,
    ...(failure ? { notice: 'Una parte de las empresas no respondió a tiempo: esta lista puede estar incompleta.' } : {}),
    ...(!ranked.items.length ? { notice: offset ? 'No quedan más personas en estas empresas.' : 'Encontré empresas, pero ninguna persona con esos cargos en ellas. Prueba con cargos más amplios o sin nivel.' } : {}),
  };
}

/** Runs an approved search with the strategy its criteria resolve to (search-proposal.ts). */
export async function runCoworkSearch(criteria: CoworkSearchCriteria, userId: string, request: SearchRequest = requestApolloSearch) {
  const strategy = coworkSearchStrategy(criteria);
  if (strategy === 'companies_first') return searchCompaniesFirst(criteria, userId, request);
  return normalizeCoworkSearchResult(await request(coworkApolloPayload(criteria, userId)), criteria.limit, strategy === 'companies' ? 'companies' : 'people',
    criteria.rolePolicy, criteria.page || 1);
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
  return admitCoworkContinuation(client, scope, runId,
    'Continúa a partir del resultado de búsqueda completado del trabajo anterior, dentro del mismo encargo. Presenta lo encontrado agrupado por empresa: cuántas personas y empresas trajo, quiénes parecen decidir la compra según su cargo (role y fit, que son hipótesis) y cualquier aviso (notice). Propón el siguiente paso concreto, por ejemplo guardar a los adecuados en un solo lote. Si result.next no es null, ofrece «Traer más» como respuesta sugerida; al pedirlo, propones los mismos criterios con page y offset de result.next. No repitas la búsqueda externa: ya está completada y su resultado está en el historial.');
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
    const result = await withSearchTeamLocks(client, scope, await runCoworkSearch(criteria, scope.userId));
    await requireCoworkWorkerAccess(client, scope);
    const finished = await client.rpc('cowork_finish_search', { ...args, p_success: true,
      p_payload: { action: 'prospecting.search', input: criteria, result } });
    if (finished.error) throw finished.error;
    if (finished.data === true) await admitSearchContinuation(client, scope, runId);
    return { processed: finished.data === true ? 1 : 0, claimed: true };
  } catch (error) {
    const reason = error instanceof Error && error.message === 'Search quota exhausted'
      ? 'quota_exhausted' : 'unknown';
    const failed = await client.rpc('cowork_finish_search', { ...args, p_success: false, p_payload: { reason } });
    if (failed.error) throw failed.error;
    return { processed: 0, claimed: true };
  }
}

/**
 * «Guardado por Ana» and the other team notices on the people a search found (Plan 6, PR-E), by provider id or LinkedIn, so
 * Cowork says it before proposing to save someone a teammate already has. Best effort: if the read fails, the result goes as it is.
 */
async function withSearchTeamLocks<Result extends { items?: unknown[] }>(
  client: ReturnType<typeof getSupabaseAdminClient>, scope: { userId: string; organizationId: string }, result: Result,
): Promise<Result> {
  const people = (result.items || []) as Array<Record<string, unknown>>;
  const providerIds = people.map(item => String(item.id || '')).filter(id => id.startsWith('apollo:')).map(id => id.slice('apollo:'.length));
  if (!providerIds.length) return result;
  try {
    const locks = await readTeamLocks(client as never, scope, { providerIds, linkedinUrls: people.map(item => String(item.linkedin_url || '')) });
    if (!locks.enabled) return result;
    const items = people.map(item => {
      const id = String(item.id || '');
      const lock = (id.startsWith('apollo:') ? locks.byProviderId[id.slice('apollo:'.length)] : undefined)
        || locks.byLinkedin[normalizeLockLinkedin(item.linkedin_url)];
      const notice = teamLockNotice(lock);
      return notice ? { ...item, teamLock: notice.text, teamLockBlocks: notice.blocks } : item;
    });
    return { ...result, items };
  } catch {
    return result;
  }
}
