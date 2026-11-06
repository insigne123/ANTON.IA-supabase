import { claimForCoworkUsers } from './worker-users';
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
import { coworkOwnSavedByProvider } from './prepare-batch';
import { normalizeLockLinkedin, teamLockNotice } from '@/lib/team-lock';
import type { AudienceRolePolicy } from '@/lib/cowork/audience-analysis';
import { linkedinProfilesMatch } from '@/lib/linkedin-url';
import { sectorFromIndustryCodes } from '@/lib/industry-codes';
import { companySectorClassifier, searchCountry, type CompanySector, type CompanySectorClassifier } from '@/lib/server/company-sectors';
import { COWORK_CONTINUE_AFTER_SEARCH } from '@/lib/cowork/continuation-messages';

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
type Company = { id: string; name: string | null; website: string | null; linkedin: string | null; industry: string | null; employees: number | null;
  /** The sector was estimated by an AI from its site or the web (src/lib/server/company-sectors.ts), not given by Apollo. */
  industryEstimated?: boolean };

/** The sector Apollo gives, else the one its NAICS or SIC codes say: the company search brings no industry (src/lib/industry-codes.ts). */
function companyIndustry(org: ProviderRecord) {
  return text(org.industry) || sectorFromIndustryCodes({ naics: org.naics_codes, sic: org.sic_codes });
}

function companyOf(org: ProviderRecord): Company {
  return { id: org.id, name: text(org.name), website: webUrl(org.website_url), linkedin: webUrl(org.linkedin_url),
    industry: companyIndustry(org), employees: count(org.estimated_num_employees) };
}

/** One person as Cowork shows and saves it; the company found first fills what the people search leaves out. */
function personRow(lead: ProviderRecord, company?: Company, estimated?: CompanySector) {
  const organization = record(lead.organization);
  const given = text(organization.industry || lead.industry);
  const industry = given || company?.industry || estimated?.sector || null;
  const industryEstimated = !given && Boolean(company?.industry ? company.industryEstimated : estimated);
  return {
    id: `apollo:${lead.id}`, name: text(lead.name || lead.full_name), title: text(lead.title),
    company: text(organization.name || lead.org_name || lead.organization_name) || company?.name || null,
    linkedin_url: webUrl(lead.linkedin_url),
    company_website: webUrl(organization.website_url || lead.organization_website) || company?.website || null,
    company_linkedin: webUrl(organization.linkedin_url) || company?.linkedin || null,
    // Search does not reveal or verify mailbox addresses.
    email: null, status: 'No guardado', industry,
    employees: count(lead.organization_size) ?? company?.employees ?? null,
    location: [lead.city, lead.country].filter(item => typeof item === 'string').join(', ').slice(0, 500),
    ...(industryEstimated ? { industryEstimated: true } : {}),
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

/**
 * What a company search can say. Apollo's company search returns neither the industry nor the headcount nor the city of each
 * company (docs.apollo.io, Organization Search, 6 Nov 2026): the companies match the industries and places searched, by keyword.
 */
export const COMPANY_SEARCH_NOTICE = 'Apollo no entrega el rubro, la dotación ni la ciudad de cada empresa en esta búsqueda: las empresas calzan con los rubros y la sede buscados, por palabras clave. El rubro que aparece viene de su código de actividad (NAICS o SIC) o, con industryEstimated, lo estimó una IA con su sitio web. Confirma el encaje antes de buscar personas. Son empresas, no contactos guardables como personas.';

/**
 * A provider answer as Cowork shows it. `sectors` are the sectors an AI estimated for the companies Apollo gave none
 * (estimateSectors): by provider id for a company search, by companyKey for a people search.
 */
export function normalizeCoworkSearchResult(value: unknown, limit: number, target: 'people' | 'companies' = 'people', rolePolicy?: AudienceRolePolicy | null, page = 1,
  sectors?: Map<string, CompanySector>) {
  if (target === 'companies') {
    const payload = z.object({ organizations: z.array(providerLead).max(1000) }).parse(value);
    const next = payload.organizations.length >= limit && page < COWORK_SEARCH_MAX_PAGE ? { page: page + 1 } : null;
    return { scope: 'external_company_search', provider: 'apollo', limit, page,
      returned: Math.min(payload.organizations.length, limit), truncated: Boolean(next), hasMore: Boolean(next), next,
      items: payload.organizations.slice(0, limit).map(org => {
        const given = companyIndustry(org);
        const estimated = given ? undefined : sectors?.get(org.id);
        return {
          id: `apollo-company:${org.id}`, name: text(org.name), domain: text(org.primary_domain),
          website: webUrl(org.website_url), linkedin_url: webUrl(org.linkedin_url),
          industry: given || estimated?.sector || null, employees: typeof org.estimated_num_employees === 'number' ? org.estimated_num_employees : null,
          location: [org.city, org.country].filter(item => typeof item === 'string').join(', ').slice(0, 500),
          ...(estimated ? { industryEstimated: true } : {}),
        };
      }), notice: COMPANY_SEARCH_NOTICE };
  }
  const payload = z.object({ leads: z.array(providerLead).max(1000) }).parse(value);
  const ranked = rankedRows(payload.leads.map(lead => {
    const key = companyKey(lead);
    return { ...personRow(lead, undefined, key ? sectors?.get(key) : undefined), companyKey: key };
  }), { rolePolicy, limit });
  const next = payload.leads.length >= limit && page < COWORK_SEARCH_MAX_PAGE ? { page: page + 1 } : null;
  return {
    scope: 'external_search', provider: 'apollo', strategy: 'people', limit, page,
    returned: ranked.items.length, truncated: Boolean(next), hasMore: Boolean(next), next,
    roleNote: COWORK_SEARCH_ROLE_NOTE, items: ranked.items,
  };
}

type SearchRequest = (payload: Record<string, unknown>) => Promise<unknown>;

/** The website's host, for reading its home page. */
function domainOf(value: unknown) {
  const url = webUrl(value);
  if (!url) return typeof value === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
  return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
}

/**
 * The sectors of the companies Apollo gave none, estimated by an AI (src/lib/server/company-sectors.ts). Best effort: without
 * the classifier, or if it fails, the companies go without a sector as before.
 */
async function estimateSectors(classify: CompanySectorClassifier | null, criteria: CoworkSearchCriteria,
  companies: Array<{ key: string; name: string | null; domain: string | null; location?: string | null }>) {
  const missing = companies.flatMap(company => (company.name ? [{ key: company.key, name: company.name, domain: company.domain, location: company.location ?? null }] : []));
  if (!classify || !missing.length) return new Map<string, CompanySector>();
  try {
    return await classify(missing, { country: searchCountry(criteria.companyLocations?.length ? criteria.companyLocations : criteria.locations) });
  } catch {
    return new Map<string, CompanySector>();
  }
}

/**
 * «Empresas primero»: the companies of the criteria (one provider search), then the people with those roles inside
 * them, 50 companies per call, ranked by who may decide the purchase. The page moves through companies; offset
 * through the people of those same companies, so «Traer más» brings new people before new companies.
 */
async function searchCompaniesFirst(criteria: CoworkSearchCriteria, userId: string, request: SearchRequest, classify: CompanySectorClassifier | null) {
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
  // The sector of the companies that have people and no sector from Apollo, before ranking: the reason of fit says it.
  const companyOfLead = (lead: ProviderRecord) => { const key = companyKey(lead); return key ? byId.get(key) || byName.get(key) : undefined; };
  const withPeople = new Map([...leads.values()].flatMap(lead => { const company = companyOfLead(lead); return company && !company.industry ? [[company.id, company] as const] : []; }));
  const estimated = await estimateSectors(classify, criteria, [...withPeople.values()].map(company => ({ key: company.id, name: company.name, domain: domainOf(company.website) })));
  for (const [id, sector] of estimated) {
    const company = withPeople.get(id);
    if (company) { company.industry = sector.sector; company.industryEstimated = true; }
  }
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

/**
 * Runs an approved search with the strategy its criteria resolve to (search-proposal.ts). The companies Apollo gives no sector
 * get one estimated by an AI when it is on (COMPANY_SECTOR_AI_ENABLED, src/lib/server/company-sectors.ts).
 */
export async function runCoworkSearch(criteria: CoworkSearchCriteria, userId: string, request: SearchRequest = requestApolloSearch,
  classify: CompanySectorClassifier | null = companySectorClassifier()) {
  const strategy = coworkSearchStrategy(criteria);
  if (strategy === 'profile') {
    const valid = coworkSearchCriteriaSchema.parse(criteria);
    const payload = z.object({ leads: z.array(providerLead).max(1) }).parse(await request(coworkApolloPayload(valid, userId)));
    if (payload.leads.some(lead => !linkedinProfilesMatch(webUrl(lead.linkedin_url), valid.linkedinUrl))) {
      throw new Error('El proveedor devolvió otro perfil de LinkedIn. No se guardó ningún contacto.');
    }
    return { ...normalizeCoworkSearchResult(payload, 1), strategy: 'profile', profileUrl: valid.linkedinUrl,
      truncated: false, hasMore: false, next: null,
      notice: payload.leads.length
        ? 'Encontré a la persona del perfil compartido. Puedes guardarla y después preparar la invitación; todavía no se guardó ni se envió nada.'
        : 'El proveedor no encontró a la persona de este perfil. Puedes abrir su perfil y guardarla desde la extensión de ANTON.IA.' };
  }
  if (strategy === 'companies_first') return searchCompaniesFirst(criteria, userId, request, classify);
  const answer = await request(coworkApolloPayload(criteria, userId));
  const target = strategy === 'companies' ? 'companies' : 'people';
  return normalizeCoworkSearchResult(answer, criteria.limit, target, criteria.rolePolicy, criteria.page || 1,
    await estimateSectors(classify, criteria, companiesWithoutSector(answer, target, criteria.limit)));
}

/** The companies of a provider answer that came without a sector: the ones a company search shows, or the companies of the people found. */
function companiesWithoutSector(answer: unknown, target: 'people' | 'companies', limit: number) {
  if (target === 'companies') {
    const parsed = z.object({ organizations: z.array(providerLead).max(1000) }).safeParse(answer);
    return (parsed.success ? parsed.data.organizations.slice(0, limit) : []).filter(org => !companyIndustry(org)).map(org => ({
      key: org.id, name: text(org.name), domain: domainOf(org.primary_domain) || domainOf(org.website_url),
      location: [org.city, org.country].filter(item => typeof item === 'string').join(', ') || null,
    }));
  }
  const parsed = z.object({ leads: z.array(providerLead).max(1000) }).safeParse(answer);
  const companies = new Map<string, { key: string; name: string | null; domain: string | null }>();
  for (const lead of parsed.success ? parsed.data.leads : []) {
    const organization = record(lead.organization);
    const key = companyKey(lead);
    if (!key || companies.has(key) || text(organization.industry || lead.industry)) continue;
    companies.set(key, { key, name: text(organization.name || lead.organization_name || lead.org_name),
      domain: domainOf(organization.primary_domain) || domainOf(organization.website_url || lead.organization_website) });
  }
  return [...companies.values()];
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
    COWORK_CONTINUE_AFTER_SEARCH);
}
/** Only the scheduled worker consumes quota/calls Apollo. Claims are never replayed. */
export async function processCoworkSearchQueue() {
  if (process.env.COWORK_ENABLED !== 'true' || process.env.COWORK_EXTERNAL_SEARCH_ENABLED !== 'true') return { processed: 0, claimed: false };
  const client = getSupabaseAdminClient();
  const job = await claimForCoworkUsers(async (userId) => {
    const claim = await client.rpc('cowork_take_search', { p_user_id: userId });
    if (claim.error) throw claim.error;
    return claim.data?.[0];
  });
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
    const result = await withOwnSavedContacts(client, scope, await withSearchTeamLocks(client, scope, await runCoworkSearch(criteria, scope.userId)));
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

/**
 * The people of a search who are already among the person's own contacts carry savedLeadId: the table says «En tus contactos»
 * and the model counts them apart («6 nuevas; 4 ya estaban en tus contactos») instead of proposing to save all ten and then
 * showing a card for six. Best effort: if the read fails, the result goes as it is.
 */
async function withOwnSavedContacts<Result extends { items?: unknown[] }>(
  client: ReturnType<typeof getSupabaseAdminClient>, scope: { userId: string; organizationId: string }, result: Result,
): Promise<Result> {
  const people = (result.items || []) as Array<Record<string, unknown>>;
  try {
    const saved = await coworkOwnSavedByProvider(client, scope, people.map(item => String(item.id || '')));
    if (!saved.size) return result;
    return { ...result, items: people.map(item => (saved.has(String(item.id)) ? { ...item, savedLeadId: saved.get(String(item.id)) } : item)) };
  } catch {
    return result;
  }
}
