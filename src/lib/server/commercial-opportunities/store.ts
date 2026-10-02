import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { GRUPOEXPRO_PILOT } from '@/lib/commercial-opportunities/pilot';
import { HIRING_WINDOW_DAYS, OPPORTUNITY_STATUSES, jobAdFromSignal, type HiringOpportunityData, type OpportunityStatus } from '@/lib/commercial-opportunities/records';
import type { JobAd } from '@/lib/commercial-opportunities/hiring';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import type { HiringSearchProfile, HiringStore, HiringSyncSource } from './sync';

/**
 * Reads and writes of «Oportunidades» (plan 8, phase 3). The tables have no member grants: every call here runs with the
 * service client after requireOpportunitiesAccess, and every query is scoped to the organization of the signed-in person.
 */
type Scope = { userId: string; organizationId: string };
const PAGE = 1000;
const DAY = 86_400_000;

const PROFILE_COLUMNS = 'id,name,offer,roles,regions,min_ads,sources,updated_at';
type ProfileRow = { id: string; name: string; offer: string; roles: string[]; regions: string[]; min_ads: number; sources: string[]; updated_at: string };
const toProfile = (row: ProfileRow): HiringSearchProfile & { updatedAt: string } => ({
  id: row.id, name: row.name, offer: row.offer, roles: row.roles || [], regions: row.regions || [], minAds: row.min_ads, updatedAt: row.updated_at,
});

function fail(what: string, error: unknown): never {
  console.error(`[commercial-opportunities] ${what}:`, error);
  throw new Error(`No se pudo ${what}.`);
}

/** The organization's «contratando» profile; the first time, the pilot's starting point (editable in the page). */
export async function ensureHiringProfile(client: SupabaseClient, scope: Scope) {
  const read = () => client.from('commercial_opportunity_profiles').select(PROFILE_COLUMNS)
    .eq('organization_id', scope.organizationId).eq('active', true).contains('sources', ['hiring'])
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  const found = await read();
  if (found.error) fail('leer el perfil de búsqueda', found.error);
  if (found.data) return toProfile(found.data as ProfileRow);
  const created = await client.from('commercial_opportunity_profiles').insert({
    organization_id: scope.organizationId, created_by: scope.userId, name: GRUPOEXPRO_PILOT.name, offer: GRUPOEXPRO_PILOT.offer,
    roles: [...GRUPOEXPRO_PILOT.roles], regions: [...GRUPOEXPRO_PILOT.regions], min_ads: GRUPOEXPRO_PILOT.minAds, sources: ['hiring'],
  }).select(PROFILE_COLUMNS).single();
  if (created.data) return toProfile(created.data as ProfileRow);
  // Two tabs opening the page at once: the other one created it.
  const again = await read();
  if (again.error || !again.data) fail('crear el perfil de búsqueda', created.error || again.error);
  return toProfile(again.data as ProfileRow);
}

const list = (max: number, length: number) => z.array(z.string().transform(value => value.replace(/\s+/g, ' ').trim()).pipe(z.string().min(2).max(length)))
  .max(max).transform(values => [...new Map(values.map(value => [value.toLowerCase(), value])).values()]);
export const hiringProfilePatchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  offer: z.string().trim().max(2000),
  roles: list(40, 80).refine(values => values.length > 0, 'Agrega al menos un cargo.'),
  regions: list(20, 60),
  minAds: z.number().int().min(1).max(100),
}).strict();

export async function updateHiringProfile(client: SupabaseClient, scope: Scope, id: string, patch: z.infer<typeof hiringProfilePatchSchema>) {
  const { data, error } = await client.from('commercial_opportunity_profiles').update({
    name: patch.name, offer: patch.offer, roles: patch.roles, regions: patch.regions, min_ads: patch.minAds, updated_at: new Date().toISOString(),
  }).eq('id', id).eq('organization_id', scope.organizationId).select(PROFILE_COLUMNS).maybeSingle();
  if (error) fail('guardar el perfil de búsqueda', error);
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
export async function recentRuns(client: SupabaseClient, scope: Scope) {
  const { data, error } = await client.from('commercial_opportunity_runs')
    .select('id,source,status,started_at,finished_at,fetched,created,updated,cost_estimate_usd,error')
    .eq('organization_id', scope.organizationId).in('source', ['jsearch', 'linkedin'])
    .order('started_at', { ascending: false }).limit(8);
  if (error) fail('leer las búsquedas', error);
  return (data || []).map((row: Record<string, any>): OpportunityRunView => ({
    id: row.id, source: row.source, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, fetched: row.fetched,
    created: row.created, updated: row.updated, costUsd: Number(row.cost_estimate_usd) || 0, error: row.error,
  }));
}

export async function monthSpentUsd(client: SupabaseClient, scope: Scope, since: string) {
  const { data, error } = await client.from('commercial_opportunity_runs').select('cost_estimate_usd')
    .eq('organization_id', scope.organizationId).gte('started_at', since).limit(5000);
  if (error) fail('leer el gasto del mes', error);
  return (data || []).reduce((sum: number, row: { cost_estimate_usd: number | string }) => sum + (Number(row.cost_estimate_usd) || 0), 0);
}

/** The HiringStore of a sync, over the service client and the person's organization. */
export function supabaseHiringStore(client: SupabaseClient, scope: Scope & { profileId: string }, trigger: 'manual' | 'schedule'): HiringStore {
  const runs = () => client.from('commercial_opportunity_runs');
  return {
    monthSpentUsd: since => monthSpentUsd(client, scope, since),
    async closeStaleRuns(before, now) {
      const { error } = await runs().update({ status: 'failed', finished_at: now, error: 'La búsqueda se cortó antes de terminar.' })
        .eq('organization_id', scope.organizationId).eq('status', 'running').lt('started_at', before);
      if (error) fail('cerrar búsquedas cortadas', error);
    },
    async hasRunningRun(since) {
      const { data, error } = await runs().select('id').eq('organization_id', scope.organizationId).eq('status', 'running')
        .gte('started_at', since).limit(1);
      if (error) fail('revisar búsquedas en curso', error);
      return Boolean(data?.length);
    },
    async startRun(input) {
      const { data, error } = await runs().insert({
        organization_id: scope.organizationId, profile_id: scope.profileId, source: input.source, trigger, status: input.status,
        requested_by: scope.userId, finished_at: input.status === 'running' ? null : (input.finishedAt ?? new Date().toISOString()),
        cost_estimate_usd: input.costUsd ?? 0, error: input.error?.slice(0, 1000) ?? null,
      }).select('id').single();
      if (error || !data) fail('registrar la búsqueda', error);
      return String(data.id);
    },
    async finishRun(id, patch) {
      const { error } = await runs().update({
        status: patch.status, finished_at: patch.finishedAt, fetched: patch.fetched, created: patch.created, updated: patch.updated,
        cost_estimate_usd: patch.costUsd, error: patch.error?.slice(0, 1000) ?? null,
      }).eq('id', id).eq('organization_id', scope.organizationId);
      if (error) fail('cerrar la búsqueda', error);
    },
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
    async saveOpportunities(rows) {
      const ids = new Map<string, string>();
      for (let index = 0; index < rows.length; index += 200) {
        const { data, error } = await client.from('commercial_opportunities')
          .upsert(rows.slice(index, index + 200), { onConflict: 'organization_id,kind,dedupe_key' }).select('id,dedupe_key');
        if (error) fail('guardar las empresas', error);
        for (const row of data || []) ids.set(String((row as { dedupe_key: string }).dedupe_key), String((row as { id: string }).id));
      }
      return ids;
    },
    async saveSignals(rows) {
      for (let index = 0; index < rows.length; index += 500) {
        const { error } = await client.from('commercial_opportunity_signals')
          .upsert(rows.slice(index, index + 500), { onConflict: 'organization_id,source,external_id' });
        if (error) fail('guardar los avisos', error);
      }
    },
  };
}
