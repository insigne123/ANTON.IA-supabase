import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { suggestedHiringProfile } from '@/lib/commercial-opportunities/profile-suggestion';
import { SEIA_SECTORS } from '@/lib/commercial-opportunities/projects';
import {
  HIRING_WINDOW_DAYS, OPPORTUNITY_STATUSES, jobAdFromSignal, tenderFromStoredRow, type HiringOpportunityData, type OpportunityStatus,
  type ProjectOpportunityData, type StoredTenderRow, type TenderOpportunityData,
} from '@/lib/commercial-opportunities/records';
import type { Tender, TenderAiVerdict } from '@/lib/commercial-opportunities/tenders';
import type { JobAd } from '@/lib/commercial-opportunities/hiring';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import { commaItems } from '@/lib/profile/profile-lists';
import { regionsFromPlaces } from '@/lib/commercial-opportunities/search-terms';
import { DEFAULT_SCHEDULE, normalizeSchedule, type OpportunitySchedule } from '@/lib/commercial-opportunities/schedule';
import { profileOffer, profileOfferDetails, readOrganizationOffer } from '@/lib/server/suplia-context';
import { generateTenderTerms, type PerfilOffer, type TenderTerms } from './search-ai';
import type { HiringSearchProfile, HiringStore, HiringSyncSource } from './sync';
import type { TenderStore } from './tender-sync';
import type { ProjectStore } from './project-import';

/**
 * Reads and writes of «Oportunidades» (plan 8, phase 3). The tables have no member grants: every call here runs with the
 * service client after requireOpportunitiesAccess, and every query is scoped to the organization of the signed-in person.
 */
type Scope = { userId: string; organizationId: string };
const PAGE = 1000;
const DAY = 86_400_000;

const PROFILE_COLUMNS = 'id,name,offer,roles,regions,min_ads,keywords,unspsc_codes,seia_sectors,min_investment_usd,sources,updated_at';
type ProfileRow = {
  id: string; name: string; offer: string; roles: string[]; regions: string[]; min_ads: number; keywords: string[]; unspsc_codes: string[];
  seia_sectors: string[]; min_investment_usd: number | string | null; sources: string[]; updated_at: string;
};
/** Every source on: the profile has no per-source switch yet, and a source without its key is skipped anyway. */
const ALL_SOURCES = ['hiring', 'tender', 'compra_agil', 'project'];
export type StoredHiringProfile = HiringSearchProfile & {
  keywords: string[]; unspscCodes: string[]; sectors: string[]; minInvestmentUsd: number | null; updatedAt: string;
};
const toProfile = (row: ProfileRow): StoredHiringProfile => ({
  id: row.id, name: row.name, offer: row.offer, roles: row.roles || [], regions: row.regions || [], minAds: row.min_ads,
  keywords: row.keywords || [], unspscCodes: row.unspsc_codes || [], sectors: row.seia_sectors || [],
  minInvestmentUsd: row.min_investment_usd === null || row.min_investment_usd === undefined ? null : Number(row.min_investment_usd), updatedAt: row.updated_at,
});

function fail(what: string, error: unknown): never {
  console.error(`[commercial-opportunities] ${what}:`, error);
  throw new Error(`No se pudo ${what}.`);
}

const readHiringProfile = (client: SupabaseClient, scope: Scope) => client.from('commercial_opportunity_profiles').select(PROFILE_COLUMNS)
  .eq('organization_id', scope.organizationId).eq('active', true).contains('sources', ['hiring'])
  .order('created_at', { ascending: true }).limit(1).maybeSingle();

/** The organization's profile, or null when nobody opened «Oportunidades» yet. Read only: Cowork never creates it. */
export async function findHiringProfile(client: SupabaseClient, scope: Scope) {
  const found = await readHiringProfile(client, scope);
  if (found.error) fail('leer el perfil de búsqueda', found.error);
  return found.data ? toProfile(found.data as ProfileRow) : null;
}

export type PerfilForOpportunities = PerfilOffer & { regions: string[] };

/**
 * What the person's «Perfil» says for «Oportunidades» (Plan 15): what they sell (with the organization's offer when their
 * own is empty), their services and sector, and the regions of «Tu cliente ideal». Any failure reads as an empty Perfil.
 */
export async function readPerfilForOpportunities(client: SupabaseClient, scope: Scope): Promise<PerfilForOpportunities> {
  try {
    const { data } = await client.from('profiles').select('*').eq('id', scope.userId).maybeSingle();
    const person = (data as Record<string, unknown> | null) || null;
    const details = profileOfferDetails(person);
    const signatures = person?.signatures;
    const extended = signatures && typeof signatures === 'object' && !Array.isArray(signatures) ? (signatures as Record<string, unknown>).profile_extended : null;
    const places = commaItems(extended && typeof extended === 'object' && !Array.isArray(extended) ? (extended as Record<string, unknown>).targetLocations : null);
    const offer = profileOffer(person) || await readOrganizationOffer(client, scope.organizationId);
    return { offer: offer || null, services: details.services, sector: details.sector, regions: regionsFromPlaces(places) };
  } catch {
    return { offer: null, services: [], sector: null, regions: [] };
  }
}

/**
 * What «Define qué buscas» starts with while the organization has no profile (Plan 10): GrupoExpro's pilot values for
 * GrupoExpro, and for anyone else their own offer and the regions of their ideal customer from «Perfil». Reads only: the
 * profile is created when the person saves.
 */
export async function readHiringProfileSuggestion(client: SupabaseClient, scope: Scope) {
  const [organization, perfil] = await Promise.all([
    client.from('organizations').select('name').eq('id', scope.organizationId).maybeSingle(),
    readPerfilForOpportunities(client, scope),
  ]);
  const suggestion = suggestedHiringProfile({ organizationName: (organization.data as { name?: string } | null)?.name ?? null, offer: perfil.offer });
  return suggestion.pilot ? suggestion : { ...suggestion, regions: perfil.regions };
}

type Terms = (perfil: PerfilOffer) => Promise<TenderTerms>;

/**
 * The search follows «Perfil» (Plan 15): the offer always comes from there, and the words of the tender search and the SEIA
 * sectors are generated from it when the profile has none yet, when the offer changed, or when the person asks again.
 * Words the person adjusted stay until the offer changes. Without an offer in «Perfil», nothing changes.
 */
export async function refreshHiringProfileFromPerfil(client: SupabaseClient, scope: Scope, profile: StoredHiringProfile,
  options: { force?: boolean; terms?: Terms; perfil?: PerfilForOpportunities } = {}): Promise<StoredHiringProfile> {
  const perfil = options.perfil ?? await readPerfilForOpportunities(client, scope);
  const offer = perfil.offer?.trim() || '';
  const offerChanged = Boolean(offer) && offer !== profile.offer;
  if (!options.force && !offerChanged && profile.keywords.length) return profile;
  if (!offer && !perfil.services.length) return profile;
  const terms = await (options.terms ?? generateTenderTerms)(perfil);
  const { data, error } = await client.from('commercial_opportunity_profiles').update({
    ...(offer ? { offer: offer.slice(0, 2000) } : {}),
    ...(terms.keywords.length ? { keywords: terms.keywords } : {}),
    ...(terms.sectors.length ? { seia_sectors: terms.sectors } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', profile.id).eq('organization_id', scope.organizationId).select(PROFILE_COLUMNS).maybeSingle();
  if (error) fail('actualizar la búsqueda con tu Perfil', error);
  return data ? toProfile(data as ProfileRow) : profile;
}

/** The organization's first profile, from what the person saved in «Define qué buscas». */
export async function createHiringProfile(client: SupabaseClient, scope: Scope, patch: z.infer<typeof hiringProfilePatchSchema>) {
  const created = await client.from('commercial_opportunity_profiles').insert({
    organization_id: scope.organizationId, created_by: scope.userId, name: patch.name, offer: patch.offer, roles: patch.roles,
    regions: patch.regions, min_ads: patch.minAds, keywords: patch.keywords ?? [], unspsc_codes: [...new Set(patch.unspscCodes ?? [])],
    seia_sectors: [...new Set(patch.sectors ?? [])], min_investment_usd: patch.minInvestmentUsd ?? null, sources: ALL_SOURCES,
  }).select(PROFILE_COLUMNS).single();
  if (created.data) return toProfile(created.data as ProfileRow);
  // Two tabs saving at once: the other one created it, so this save updates it.
  const existing = await findHiringProfile(client, scope);
  if (!existing) fail('crear el perfil de búsqueda', created.error);
  return updateHiringProfile(client, scope, existing.id, patch);
}

const list = (max: number, length: number) => z.array(z.string().transform(value => value.replace(/\s+/g, ' ').trim()).pipe(z.string().min(2).max(length)))
  .max(max).transform(values => [...new Map(values.map(value => [value.toLowerCase(), value])).values()]);
export const hiringProfilePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).default('Qué buscamos'),
  /** Plan 15: the server takes the offer from «Perfil»; this one is kept only while «Perfil» has none. */
  offer: z.string().trim().max(2000).default(''),
  // The roles may be chosen when searching (Plan 15): a profile can start without them.
  roles: list(40, 80),
  regions: list(20, 60),
  minAds: z.number().int().min(1).max(100),
  keywords: list(40, 80).optional(),
  unspscCodes: z.array(z.string().trim().regex(/^\d{2,8}$/, 'Los códigos UNSPSC son de 2 a 8 dígitos.')).max(40).optional(),
  sectors: z.array(z.enum(SEIA_SECTORS.map(sector => sector.id) as [string, ...string[]])).max(20).optional(),
  minInvestmentUsd: z.number().min(0).max(100_000_000_000).nullable().optional(),
}).strict();

export async function updateHiringProfile(client: SupabaseClient, scope: Scope, id: string, patch: z.infer<typeof hiringProfilePatchSchema>) {
  const { data, error } = await client.from('commercial_opportunity_profiles').update({
    name: patch.name, offer: patch.offer, roles: patch.roles, regions: patch.regions, min_ads: patch.minAds,
    ...(patch.keywords ? { keywords: patch.keywords } : {}), ...(patch.unspscCodes ? { unspsc_codes: [...new Set(patch.unspscCodes)] } : {}),
    ...(patch.sectors ? { seia_sectors: [...new Set(patch.sectors)] } : {}), ...(patch.minInvestmentUsd !== undefined ? { min_investment_usd: patch.minInvestmentUsd } : {}),
    sources: ALL_SOURCES, updated_at: new Date().toISOString(),
  }).eq('id', id).eq('organization_id', scope.organizationId).select(PROFILE_COLUMNS).maybeSingle();
  if (error) fail('guardar el perfil de búsqueda', error);
  return data ? toProfile(data as ProfileRow) : null;
}

/** The roles and regions of the last search by hand, kept for the daily search (Plan 15: «Usar en la búsqueda diaria»). */
export async function saveSearchChoice(client: SupabaseClient, scope: Scope, id: string, choice: { roles: string[]; regions: string[] }) {
  const { data, error } = await client.from('commercial_opportunity_profiles').update({
    roles: choice.roles.slice(0, 40), regions: choice.regions.slice(0, 20), updated_at: new Date().toISOString(),
  }).eq('id', id).eq('organization_id', scope.organizationId).select(PROFILE_COLUMNS).maybeSingle();
  if (error) fail('guardar los cargos y regiones', error);
  return data ? toProfile(data as ProfileRow) : null;
}

const OPPORTUNITY_COLUMNS = 'id,title,company_name,company_domain,company_linkedin_url,region,url,score,reasons,status,claimed_by,signal_count,published_at,first_seen_at,last_seen_at,data';
type OpportunityRow = {
  id: string; title: string; company_name: string | null; company_domain: string | null; company_linkedin_url: string | null; region: string | null;
  url: string | null; score: number; reasons: string[]; status: OpportunityStatus; claimed_by: string | null; signal_count: number;
  published_at: string | null; first_seen_at: string; last_seen_at: string; data: HiringOpportunityData;
};
export type HiringOpportunityView = {
  id: string; company: string; domain: string | null; linkedinUrl: string | null; region: string | null; url: string | null; score: number;
  reasons: string[]; status: OpportunityStatus; mine: boolean; ads: number; firstSeenAt: string; lastSeenAt: string; data: HiringOpportunityData;
};

/** The companies that reach the profile's minimum with an ad in the window, best first, every status (the page filters). */
export async function listHiringOpportunities(client: SupabaseClient, scope: Scope, input: { minAds: number; now?: string }) {
  const since = new Date(Date.parse(input.now ?? new Date().toISOString()) - HIRING_WINDOW_DAYS * DAY).toISOString();
  const { data, error } = await client.from('commercial_opportunities').select(OPPORTUNITY_COLUMNS)
    .eq('organization_id', scope.organizationId).eq('kind', 'hiring').gte('signal_count', input.minAds).gte('published_at', since)
    .order('score', { ascending: false }).order('signal_count', { ascending: false }).limit(300);
  if (error) fail('leer las oportunidades', error);
  return ((data || []) as OpportunityRow[]).map((row): HiringOpportunityView => ({
    id: row.id, company: row.company_name || row.title, domain: row.company_domain, linkedinUrl: row.company_linkedin_url, region: row.region,
    url: row.url, score: row.score, reasons: row.reasons || [], status: row.status, mine: row.claimed_by === scope.userId, ads: row.signal_count,
    firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, data: row.data,
  }));
}

export const opportunityStatusSchema = z.object({ status: z.enum(OPPORTUNITY_STATUSES) }).strict();

/** «Me interesa» takes the company for the person; going back to «Nueva» frees it. */
export async function setOpportunityStatus(client: SupabaseClient, scope: Scope, id: string, status: OpportunityStatus) {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === 'interested' || status === 'converted') patch.claimed_by = scope.userId;
  if (status === 'new') patch.claimed_by = null;
  const { data, error } = await client.from('commercial_opportunities').update(patch)
    .eq('id', id).eq('organization_id', scope.organizationId).select('id,status').maybeSingle();
  if (error) fail('cambiar el estado', error);
  return data as { id: string; status: OpportunityStatus } | null;
}

export type OpportunityRunView = { id: string; source: HiringSyncSource; status: string; startedAt: string; finishedAt: string | null; fetched: number; created: number; updated: number; costUsd: number; error: string | null };
const RUN_COLUMNS = 'id,source,status,started_at,finished_at,fetched,created,updated,cost_estimate_usd,error';
const RUN_SOURCES = ['jsearch', 'linkedin', 'mercado_publico', 'compra_agil', 'seia'];
const toRun = (row: Record<string, any>): OpportunityRunView => ({
  id: row.id, source: row.source, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, fetched: row.fetched,
  created: row.created, updated: row.updated, costUsd: Number(row.cost_estimate_usd) || 0, error: row.error,
});
/**
 * The last 12 runs, plus the last one of each source even when it is older (Plan 10): the daily sync writes three runs a
 * day, so the SEIA upload of the month fell out of the last 12 in four days and the page said there was none.
 */
export async function recentRuns(client: SupabaseClient, scope: Scope) {
  const runs = () => client.from('commercial_opportunity_runs').select(RUN_COLUMNS).eq('organization_id', scope.organizationId);
  const [recent, ...latest] = await Promise.all([
    runs().order('started_at', { ascending: false }).limit(12),
    ...RUN_SOURCES.map(source => runs().eq('source', source).order('started_at', { ascending: false }).limit(1)),
  ]);
  const failed = [recent, ...latest].find(result => result.error);
  if (failed) fail('leer las búsquedas', failed.error);
  const byId = new Map<string, Record<string, any>>();
  for (const row of [...(recent.data || []), ...latest.flatMap(result => result.data || [])]) byId.set(String((row as { id: string }).id), row as Record<string, any>);
  return [...byId.values()].map(toRun).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** The last run of one source of the organization, or null. */
export async function lastRunOf(client: SupabaseClient, scope: Scope, source: string) {
  const { data, error } = await client.from('commercial_opportunity_runs').select(RUN_COLUMNS)
    .eq('organization_id', scope.organizationId).eq('source', source).order('started_at', { ascending: false }).limit(1);
  if (error) fail('leer las búsquedas', error);
  return data?.[0] ? toRun(data[0] as Record<string, any>) : null;
}

export async function monthSpentUsd(client: SupabaseClient, scope: Scope, since: string) {
  const { data, error } = await client.from('commercial_opportunity_runs').select('cost_estimate_usd')
    .eq('organization_id', scope.organizationId).gte('started_at', since).limit(5000);
  if (error) fail('leer el gasto del mes', error);
  return (data || []).reduce((sum: number, row: { cost_estimate_usd: number | string }) => sum + (Number(row.cost_estimate_usd) || 0), 0);
}

type RunInput = { source: string; status: 'running' | 'skipped'; error?: string; costUsd?: number; finishedAt?: string };
/** Opportunities of any kind, upserted on (organization, kind, key): status, owner and first sighting are never in the rows. */
async function upsertOpportunities(client: SupabaseClient, rows: Array<{ dedupe_key: string }>) {
  const ids = new Map<string, string>();
  for (let index = 0; index < rows.length; index += 200) {
    const { data, error } = await client.from('commercial_opportunities')
      .upsert(rows.slice(index, index + 200), { onConflict: 'organization_id,kind,dedupe_key' }).select('id,dedupe_key');
    if (error) fail('guardar las oportunidades', error);
    for (const row of data || []) ids.set(String((row as { dedupe_key: string }).dedupe_key), String((row as { id: string }).id));
  }
  return ids;
}
/** The evidence of any source, upserted on (organization, source, external id). */
async function upsertSignals(client: SupabaseClient, rows: object[]) {
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await client.from('commercial_opportunity_signals')
      .upsert(rows.slice(index, index + 500), { onConflict: 'organization_id,source,external_id' });
    if (error) fail('guardar la evidencia', error);
  }
}
/** The run log, shared by every source: at most one search running per organization. */
function runLog(client: SupabaseClient, scope: Scope & { profileId: string }, trigger: 'manual' | 'schedule' | 'upload') {
  const runs = () => client.from('commercial_opportunity_runs');
  return {
    async closeStaleRuns(before: string, now: string) {
      const { error } = await runs().update({ status: 'failed', finished_at: now, error: 'La búsqueda se cortó antes de terminar.' })
        .eq('organization_id', scope.organizationId).eq('status', 'running').lt('started_at', before);
      if (error) fail('cerrar búsquedas cortadas', error);
    },
    async hasRunningRun(since: string) {
      const { data, error } = await runs().select('id').eq('organization_id', scope.organizationId).eq('status', 'running')
        .gte('started_at', since).limit(1);
      if (error) fail('revisar búsquedas en curso', error);
      return Boolean(data?.length);
    },
    async startRun(input: RunInput) {
      const { data, error } = await runs().insert({
        organization_id: scope.organizationId, profile_id: scope.profileId, source: input.source, trigger, status: input.status,
        requested_by: scope.userId, finished_at: input.status === 'running' ? null : (input.finishedAt ?? new Date().toISOString()),
        cost_estimate_usd: input.costUsd ?? 0, error: input.error?.slice(0, 1000) ?? null,
      }).select('id').single();
      if (error || !data) fail('registrar la búsqueda', error);
      return String(data.id);
    },
    async finishRun(id: string, patch: Parameters<HiringStore['finishRun']>[1]) {
      const { error } = await runs().update({
        status: patch.status, finished_at: patch.finishedAt, fetched: patch.fetched, created: patch.created, updated: patch.updated,
        cost_estimate_usd: patch.costUsd, error: patch.error?.slice(0, 1000) ?? null,
      }).eq('id', id).eq('organization_id', scope.organizationId);
      if (error) fail('cerrar la búsqueda', error);
    },
  };
}

/** The HiringStore of a sync, over the service client and the person's organization. */
export function supabaseHiringStore(client: SupabaseClient, scope: Scope & { profileId: string }, trigger: 'manual' | 'schedule'): HiringStore {
  const log = runLog(client, scope, trigger);
  return {
    monthSpentUsd: since => monthSpentUsd(client, scope, since),
    ...log,
    async recentSignals(since) {
      const ads: JobAd[] = [];
      for (let page = 0; page < 20; page++) {
        const { data, error } = await client.from('commercial_opportunity_signals')
          .select('source,external_id,title,location,publisher,url,posted_at,seen_at,data')
          .eq('organization_id', scope.organizationId).in('source', ['jsearch', 'linkedin', 'jooble']).gte('seen_at', since)
          .order('id', { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) fail('leer los avisos guardados', error);
        for (const row of data || []) { const ad = jobAdFromSignal(row as never); if (ad) ads.push(ad); }
        if ((data || []).length < PAGE) break;
      }
      return ads;
    },
    async knownCompanies() {
      const profile = await client.from('profiles').select('signatures').eq('id', scope.userId).maybeSingle();
      if (profile.error) fail('leer tus clientes de «Perfil»', profile.error);
      const clients = mapProfileToForm(profile.data as never).referenceClients.split(',').map(value => value.trim()).filter(Boolean);
      // The companies of the organization's saved contacts, to say «ya tienes contactos ahí» (up to 5,000 contacts).
      const companies = new Set<string>();
      for (let page = 0; page < 5; page++) {
        const { data, error } = await client.from('leads').select('company').eq('organization_id', scope.organizationId)
          .not('company', 'is', null).order('id', { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) fail('leer tus contactos', error);
        for (const row of data || []) { const company = String((row as { company: string | null }).company || '').trim(); if (company) companies.add(company); }
        if ((data || []).length < PAGE) break;
      }
      return { clients, contactsCompanies: [...companies] };
    },
    async existingKeys(keys) {
      const found = new Set<string>();
      for (let index = 0; index < keys.length; index += 200) {
        const { data, error } = await client.from('commercial_opportunities').select('dedupe_key')
          .eq('organization_id', scope.organizationId).eq('kind', 'hiring').in('dedupe_key', keys.slice(index, index + 200));
        if (error) fail('revisar las empresas guardadas', error);
        for (const row of data || []) found.add(String((row as { dedupe_key: string }).dedupe_key));
      }
      return found;
    },
    saveOpportunities: rows => upsertOpportunities(client, rows),
    saveSignals: rows => upsertSignals(client, rows),
  };
}

const TENDER_COLUMNS = 'id,kind,title,buyer_name,region,amount,currency,deadline_at,published_at,url,score,reasons,status,claimed_by,first_seen_at,last_seen_at,data';
type TenderRow = {
  id: string; kind: 'tender' | 'compra_agil'; title: string; buyer_name: string | null; region: string | null; amount: number | string | null;
  currency: string | null; deadline_at: string | null; published_at: string | null; url: string | null; score: number; reasons: string[];
  status: OpportunityStatus; claimed_by: string | null; first_seen_at: string; last_seen_at: string; data: TenderOpportunityData;
};
export type TenderOpportunityView = {
  id: string; kind: 'tender' | 'compra_agil'; title: string; buyer: string | null; region: string | null; amount: number | null; currency: string | null;
  deadlineAt: string | null; publishedAt: string | null; url: string | null; score: number; reasons: string[]; status: OpportunityStatus; mine: boolean;
  firstSeenAt: string; data: TenderOpportunityData;
};

/** Tenders and Compra Ágil quotes still open, best first and then by the nearest deadline. */
export async function listTenderOpportunities(client: SupabaseClient, scope: Scope, input: { now?: string } = {}) {
  const { data, error } = await client.from('commercial_opportunities').select(TENDER_COLUMNS)
    .eq('organization_id', scope.organizationId).in('kind', ['tender', 'compra_agil']).gte('deadline_at', input.now ?? new Date().toISOString())
    .order('score', { ascending: false }).order('deadline_at', { ascending: true }).limit(300);
  if (error) fail('leer las licitaciones', error);
  return ((data || []) as TenderRow[]).map((row): TenderOpportunityView => ({
    id: row.id, kind: row.kind, title: row.title, buyer: row.buyer_name, region: row.region, amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency, deadlineAt: row.deadline_at, publishedAt: row.published_at, url: row.url, score: row.score, reasons: row.reasons || [],
    status: row.status, mine: row.claimed_by === scope.userId, firstSeenAt: row.first_seen_at, data: row.data,
  }));
}

/** The TenderStore of a tender sync: runs, keys and rows of the person's organization through the service client. */
async function existingKeysOf(client: SupabaseClient, scope: Scope, kinds: string[], keys: string[]) {
  const found = new Set<string>();
  for (let index = 0; index < keys.length; index += 200) {
    const { data, error } = await client.from('commercial_opportunities').select('dedupe_key')
      .eq('organization_id', scope.organizationId).in('kind', kinds).in('dedupe_key', keys.slice(index, index + 200));
    if (error) fail('revisar las oportunidades guardadas', error);
    for (const row of data || []) found.add(String((row as { dedupe_key: string }).dedupe_key));
  }
  return found;
}

/** Mercado Público tenders already saved with their detail (the buyer is known): reused instead of asked again. */
async function storedTendersOf(client: SupabaseClient, scope: Scope, codes: string[]) {
  const found = new Map<string, Tender>();
  for (let index = 0; index < codes.length; index += 200) {
    const { data, error } = await client.from('commercial_opportunities')
      .select('dedupe_key,title,buyer_name,region,amount,currency,deadline_at,published_at,data')
      .eq('organization_id', scope.organizationId).eq('kind', 'tender').in('dedupe_key', codes.slice(index, index + 200))
      .not('buyer_name', 'is', null);
    if (error) fail('revisar las licitaciones guardadas', error);
    for (const row of (data || []) as StoredTenderRow[]) found.set(row.dedupe_key, tenderFromStoredRow(row));
  }
  return found;
}

/** What the model said of the organization's open tenders already saved (Plan 15), by code: reused while the offer is the same. */
async function storedVerdictsOf(client: SupabaseClient, scope: Scope) {
  const { data, error } = await client.from('commercial_opportunities').select('dedupe_key,data')
    .eq('organization_id', scope.organizationId).in('kind', ['tender', 'compra_agil']).gte('deadline_at', new Date().toISOString()).limit(2000);
  if (error) fail('revisar las licitaciones guardadas', error);
  const found = new Map<string, TenderAiVerdict>();
  for (const row of (data || []) as Array<{ dedupe_key: string; data: { ai?: Partial<TenderAiVerdict> } | null }>) {
    const ai = row.data?.ai;
    if (ai && (ai.fit === 'alta' || ai.fit === 'media') && typeof ai.reason === 'string' && typeof ai.profileKey === 'string') {
      found.set(row.dedupe_key, { fit: ai.fit, reason: ai.reason, profileKey: ai.profileKey });
    }
  }
  return found;
}

export function supabaseTenderStore(client: SupabaseClient, scope: Scope & { profileId: string }, trigger: 'manual' | 'schedule'): TenderStore {
  return {
    ...runLog(client, scope, trigger),
    existingKeys: (keys, kinds) => existingKeysOf(client, scope, kinds, keys),
    storedTenders: codes => storedTendersOf(client, scope, codes),
    storedVerdicts: () => storedVerdictsOf(client, scope),
    saveOpportunities: rows => upsertOpportunities(client, rows),
    saveSignals: rows => upsertSignals(client, rows),
  };
}

/** The ProjectStore of a SEIA upload. */
export function supabaseProjectStore(client: SupabaseClient, scope: Scope & { profileId: string }): ProjectStore {
  return {
    ...runLog(client, scope, 'upload'),
    existingKeys: keys => existingKeysOf(client, scope, ['project'], keys),
    saveOpportunities: rows => upsertOpportunities(client, rows),
    saveSignals: rows => upsertSignals(client, rows),
  };
}

const PROJECT_COLUMNS = 'id,title,company_name,region,amount,published_at,url,score,reasons,status,claimed_by,first_seen_at,last_seen_at,data';
type ProjectRow = {
  id: string; title: string; company_name: string | null; region: string | null; amount: number | string | null; published_at: string | null;
  url: string | null; score: number; reasons: string[]; status: OpportunityStatus; claimed_by: string | null; first_seen_at: string; last_seen_at: string;
  data: ProjectOpportunityData;
};
export type ProjectOpportunityView = {
  id: string; title: string; owner: string | null; region: string | null; investmentUsd: number | null; presentedAt: string | null; url: string | null;
  score: number; reasons: string[]; status: OpportunityStatus; mine: boolean; firstSeenAt: string; data: ProjectOpportunityData;
};

/** The SEIA projects of the last uploads, best first and then the most recent. */
export async function listProjectOpportunities(client: SupabaseClient, scope: Scope) {
  const { data, error } = await client.from('commercial_opportunities').select(PROJECT_COLUMNS)
    .eq('organization_id', scope.organizationId).eq('kind', 'project')
    .order('score', { ascending: false }).order('published_at', { ascending: false }).limit(300);
  if (error) fail('leer los proyectos', error);
  return ((data || []) as ProjectRow[]).map((row): ProjectOpportunityView => ({
    id: row.id, title: row.title, owner: row.company_name, region: row.region, investmentUsd: row.amount === null ? null : Number(row.amount),
    presentedAt: row.published_at, url: row.url, score: row.score, reasons: row.reasons || [], status: row.status, mine: row.claimed_by === scope.userId,
    firstSeenAt: row.first_seen_at, data: row.data,
  }));
}

const MINE_COLUMNS = 'id,kind,title,company_name,company_domain,buyer_name,region,amount,currency,deadline_at,published_at,url,score,reasons,status,signal_count,first_seen_at,updated_at,data';
type MineRow = {
  id: string; kind: 'hiring' | 'tender' | 'compra_agil' | 'project'; title: string; company_name: string | null; company_domain: string | null; buyer_name: string | null; region: string | null;
  amount: number | string | null; currency: string | null; deadline_at: string | null; published_at: string | null; url: string | null; score: number;
  reasons: string[]; status: OpportunityStatus; signal_count: number; first_seen_at: string; updated_at: string; data: Record<string, unknown> | null;
};
export type MyOpportunityView = {
  id: string; kind: MineRow['kind']; title: string; who: string | null; domain: string | null; region: string | null; amount: number | null; currency: string | null;
  deadlineAt: string | null; url: string | null; score: number; reasons: string[]; status: OpportunityStatus; ads: number; firstSeenAt: string;
  markedAt: string; data: Record<string, unknown>;
};

/**
 * «Mis oportunidades» (Plan 15): what the person marked «Me interesa», of every kind, the newest mark first. Unlike the tabs,
 * a closed tender or a company out of the 30-day window stays: the person decided to work on it.
 */
export async function listMyOpportunities(client: SupabaseClient, scope: Scope): Promise<MyOpportunityView[]> {
  const { data, error } = await client.from('commercial_opportunities').select(MINE_COLUMNS)
    .eq('organization_id', scope.organizationId).eq('claimed_by', scope.userId).in('status', ['interested', 'converted'])
    .order('updated_at', { ascending: false }).limit(200);
  if (error) fail('leer tus oportunidades', error);
  return ((data || []) as MineRow[]).map(row => ({
    id: row.id, kind: row.kind, title: row.kind === 'hiring' ? row.company_name || row.title : row.title,
    who: row.kind === 'hiring' ? null : row.kind === 'project' ? row.company_name : row.buyer_name, domain: row.company_domain, region: row.region,
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount), currency: row.currency, deadlineAt: row.deadline_at,
    url: row.url, score: row.score, reasons: row.reasons || [], status: row.status, ads: row.signal_count, firstSeenAt: row.first_seen_at,
    markedAt: row.updated_at, data: row.data && typeof row.data === 'object' ? row.data : {},
  }));
}

/**
 * When the organization's search runs by itself (Plan 15). Until the schedule columns exist (migration 20261008100000) the
 * search keeps today's schedule and the page does not offer to change it (`available: false`).
 */
export async function readSchedule(client: SupabaseClient, scope: Scope, profileId: string): Promise<OpportunitySchedule & { available: boolean }> {
  const { data, error } = await client.from('commercial_opportunity_profiles').select('schedule_enabled,schedule_days,schedule_hour')
    .eq('id', profileId).eq('organization_id', scope.organizationId).maybeSingle();
  if (error || !data) return { ...DEFAULT_SCHEDULE, available: !error && Boolean(data) };
  const row = data as { schedule_enabled?: unknown; schedule_days?: unknown; schedule_hour?: unknown };
  return { ...normalizeSchedule({ enabled: row.schedule_enabled, days: row.schedule_days, hour: row.schedule_hour }), available: true };
}

export async function saveSchedule(client: SupabaseClient, scope: Scope, profileId: string, schedule: OpportunitySchedule) {
  const clean = normalizeSchedule(schedule);
  const { error } = await client.from('commercial_opportunity_profiles').update({
    schedule_enabled: clean.enabled, schedule_days: clean.days, schedule_hour: clean.hour, updated_at: new Date().toISOString(),
  }).eq('id', profileId).eq('organization_id', scope.organizationId);
  if (error) fail('guardar el horario de la búsqueda', error);
  return clean;
}

/** When the organization's last scheduled search started, of any source, skipped ones included: one a day is enough. */
export async function lastScheduledRunAt(client: SupabaseClient, scope: Scope) {
  const { data, error } = await client.from('commercial_opportunity_runs').select('started_at')
    .eq('organization_id', scope.organizationId).eq('trigger', 'schedule').order('started_at', { ascending: false }).limit(1);
  if (error) fail('leer la última búsqueda programada', error);
  return (data?.[0] as { started_at?: string } | undefined)?.started_at ?? null;
}
