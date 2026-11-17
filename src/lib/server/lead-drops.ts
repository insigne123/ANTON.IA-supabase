import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { dayInZone } from '@/lib/admin/chile-time';
import { industryLabel } from '@/lib/companies/coverage';
import type { CoworkUserContext } from '@/lib/cowork/decision-context';
import { coworkWriterBlocks, runCoworkWriter, type CoworkWriteBrief } from '@/lib/cowork/writer';
import { renderPdf } from '@/lib/documents/render-pdf';
import type { DocBlock, DocumentSpec, Run } from '@/lib/documents/spec';
import {
  DEFAULT_DROP_PLAN, NO_DROP_PLAN, FIT_LABEL, assignDrops, companyDropCriteria, departmentLabel, dropCostNote, dropDay, dropName, dropFit, dropPlanOf, groupDropPeople, needsLookup, nextDropDay,
  personDropCriteria, personDropPlanOf, planOfPerson, pickRankedDrops, placeLabel, researchFacts, searchedFit, seniorityLabel, tidyCompany, tidyTitle, usableDrops, whyText, withoutSourceTalk, type DropCandidate, type DropCriteria,
  type DropFollowUp, type DropItem, type DropPlan, type DropScore, type IcpDeclared, type KnownPeople,
type PersonDropPlan,
} from '@/lib/lead-drops';
import { isMaskedName } from '@/lib/lead-name';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import { readCompanyFields } from '@/lib/server/company-profile';
import { resolveApolloIndustryFilters } from '@/lib/server/apollo-provider/apollo';
import { getGatewayConfig } from '@/lib/server/apollo-provider/gateway';
import { executeProviderLeadSearch } from '@/lib/server/apollo-provider/lead-provider';
import type { LeadSearchInput } from '@/lib/server/apollo-provider/validation';
import { insertCoworkContact } from '@/lib/server/cowork/save-contact';
import type { AuthContext } from '@/lib/server/auth-utils';
import { loadCoworkUserContext } from '@/lib/server/cowork/user-context';
import { ACCOUNTS_OPENED, ACCOUNT_FIT, accountDomain, accountsOf, accountsToOpen, expansionIndustries, readAccounts, saveAccounts, scoreAccounts, type DropAccount } from '@/lib/server/lead-drop-accounts';
import { dropSellerOf } from '@/lib/server/lead-drop-seller';
import { dropWriterEnabled, writeDropEmails, type DropSeller } from '@/lib/server/lead-drop-writer';
import { dropLessons, dropWishes, finderSearchTerms, scoreDropCandidates, type FinderLessons, type FinderPreferences, type FinderSeller } from '@/lib/server/lead-drop-finder';
import { profileTargetNotes } from '@/lib/profile/profile-mappings';
import { briefNewsLine, type DropResearch, type DropResearchInput } from '@/lib/server/lead-drop-research';
import { voiceSamplesFor } from '@/lib/server/voice-own-samples';
import { coworkWriterCallModel, coworkWriterEfforts, coworkWriterModels } from '@/lib/server/cowork/writer-run';
import { coworkVoicePass } from '@/lib/server/cowork/writer-voice';
import { leadsFinderMaxRunUsd, leadsFinderUsdPerLead, searchLeadsFinder } from '@/lib/server/leads-finder/client';
import { LEADS_FINDER_MAX_PER_RUN, leadsFinderIndustry } from '@/lib/server/leads-finder/input';
import { enrichedLeadRow } from '@/lib/server/leads-finder/reveal';
import { forgetInVault, isLeadsFinderId, readFromVault, storeInVault, type VaultEntry } from '@/lib/server/leads-finder/vault';

/** The reads, the preparation and the save of «Contacto del día» (src/lib/lead-drops.ts). Server only. */
type Client = SupabaseClient;
export type DropScope = { organizationId: string; userId: string };
/** A search for the drops: Leads Finder's, or Apollo's free one (searchApolloDrops), both as the vault keeps a person. */
type Search = (input: LeadSearchInput, deps: Parameters<typeof searchLeadsFinder>[1]) => Promise<{ results: VaultEntry[]; costUsd: number }>;
type Generate = (options: { schema: z.ZodTypeAny; systemPrompt: string; prompt: string; openAiModel?: string; reasoningEffort?: any;
  maxOutputTokens: number; timeoutMs: number }) => Promise<any>;

export class LeadDropsError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * What each team gets (organizations.lead_drop_size and lead_drop_weekdays): how many contacts a person and on which days. A team
 * without a row, or a database that does not have the columns yet, gets the default (one contact on Tuesdays, Wednesdays and Fridays).
 */
export async function dropPlans(client: Client, organizationIds?: string[]): Promise<Map<string, DropPlan>> {
  const plans = new Map<string, DropPlan>();
  let query: any = client.from('organizations').select('id,lead_drop_size,lead_drop_weekdays');
  if (organizationIds) query = query.in('id', organizationIds.slice(0, 500));
  const result: any = await query.limit(5000);
  if (result.error) return plans;
  for (const row of result.data || []) plans.set(String(row.id), dropPlanOf(row));
  return plans;
}
export const personPlanKey = (organizationId: string, userId: string) => `${organizationId}:${userId}`;
/**
 * The people with a plan of their own (lead_drop_person_plans, since 15 Nov 2026), by workspace and person (personPlanKey): some of a
 * team get more contacts than the rest. A database without the table yet, or a failed read, has none: everybody keeps their team's.
 */
export async function personDropPlans(client: Client, organizationIds?: string[]): Promise<Map<string, PersonDropPlan>> {
  const plans = new Map<string, PersonDropPlan>();
  let query: any = client.from('lead_drop_person_plans').select('organization_id,user_id,lead_drop_size,lead_drop_weekdays,starts_on');
  if (organizationIds) query = query.in('organization_id', organizationIds.slice(0, 500));
  const result: any = await query.limit(5000);
  if (result.error) return plans;
  for (const row of result.data || []) {
    const plan = personDropPlanOf(row);
    if (plan) plans.set(personPlanKey(String(row.organization_id), String(row.user_id)), plan);
  }
  return plans;
}
/**
 * What a team gets, or what one of its people does when `userId` is given: their own plan, the team's, or nothing when others of
 * the team have a plan of their own and they do not (planOfPerson).
 */
export async function dropPlanFor(client: Client, organizationId: string, userId?: string): Promise<DropPlan> {
  const team = (await dropPlans(client, [organizationId])).get(organizationId) ?? DEFAULT_DROP_PLAN;
  if (!userId) return team;
  const own = await personDropPlans(client, [organizationId]);
  return planOfPerson(team, own.get(personPlanKey(organizationId, userId)), own.size > 0);
}

const DAY = 86_400_000;
const text = (value: unknown, max = 300) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
/** LEAD_DROPS_MONTHLY_USD: what Apify may spend on drops in a month, across organizations (the plan is shared). */
export const dropsMonthlyUsd = (env: Record<string, string | undefined> = process.env) => {
  const value = Number(env.LEAD_DROPS_MONTHLY_USD);
  return Number.isFinite(value) && value >= 0 ? value : 3;
};
export const dropsEnabled = (env: Record<string, string | undefined> = process.env) => env.LEAD_DROPS_ENABLED !== 'off';
/**
 * Where the drops search (src/lib/lead-drops.ts): Apollo's free people search since 3 Nov 2026, so a search costs nothing and the
 * email is looked up when the person saves the contact (1 credit); LEAD_DROPS_PROVIDER=apify goes back to Leads Finder, which
 * brings the email with the search and spends the month's budget (LEAD_DROPS_MONTHLY_USD).
 */
export const dropsProvider = (env: Record<string, string | undefined> = process.env): 'apollo' | 'apify' => env.LEAD_DROPS_PROVIDER === 'apify' ? 'apify' : 'apollo';
/** What one person found costs the month's budget: nothing with Apollo's free search. */
const dropUsdPerLead = () => dropsProvider() === 'apollo' ? 0 : leadsFinderUsdPerLead();
/** Whether a search of `count` would go past the month's budget: never a free one, whatever Leads Finder spent before. */
const overBudget = (spent: number, count: number, usdPerLead: number, budget: number) => count * usdPerLead > 0 && spent + count * usdPerLead > budget;
/** LEAD_DROPS_MAX_GROUPS: how many searches one organization's drops may take a day (5 by default, 1 to 20); past that, groups join. */
export const dropsMaxGroups = (env: Record<string, string | undefined> = process.env) => {
  const value = Number(env.LEAD_DROPS_MAX_GROUPS);
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : 5;
};

/** «Tu cliente ideal» as «Perfil» keeps it. */
function declaredOf(profile: Record<string, unknown> | null | undefined): IcpDeclared {
  const form = mapProfileToForm(profile as any);
  return { roles: form.targetRoles, industries: form.targetIndustries, locations: form.targetLocations, size: form.targetCompanySize };
}

/** What the drops spent this month, in US$, across organizations. */
export async function monthSpend(client: Client, now: Date) {
  const month = `${dayInZone(now).slice(0, 7)}-01`;
  const result: any = await client.from('lead_drops').select('cost_usd').gte('drop_date', month).limit(5000);
  if (result.error) throw new LeadDropsError('No pudimos leer el gasto del mes.', 503);
  return ((result.data || []) as Array<{ cost_usd: number | string }>).reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
}

/** The people, companies and contacts the organization already has, and who got what in earlier drops: never offered again. */
/**
 * Every row of a query, a thousand at a time. The API answers at most its max_rows (1 000 in production) whatever limit is asked,
 * so one request would silently leave out the rest of a team with more: people it already has would be offered again (15 Nov 2026).
 */
const KNOWN_PAGE = 1000;
const KNOWN_MAX = 30_000;
async function allRows(build: () => any): Promise<{ data: any[]; error: unknown }> {
  const data: any[] = [];
  for (let from = 0; from < KNOWN_MAX; from += KNOWN_PAGE) {
    const page: any = await build().order('id').range(from, from + KNOWN_PAGE - 1);
    if (page.error) return { data, error: page.error };
    data.push(...(page.data || []));
    if ((page.data || []).length < KNOWN_PAGE) break;
  }
  return { data, error: null };
}

async function knownPeople(client: Client, organizationId: string, now: Date): Promise<KnownPeople> {
  const since = new Date(now.getTime() - 180 * DAY).toISOString().slice(0, 10);
  // Contactos too: a person a member saved there is theirs (lead-claim.ts), and «Por escribir» would refuse them.
  const [enriched, contacted, drops, saved]: any[] = await Promise.all([
    allRows(() => client.from('enriched_leads').select('email,linkedin_url,source_provider_id').eq('organization_id', organizationId)),
    allRows(() => client.from('contacted_leads').select('email').eq('organization_id', organizationId)),
    allRows(() => client.from('lead_drops').select('items').eq('organization_id', organizationId).gte('drop_date', since)),
    allRows(() => client.from('leads').select('email,linkedin_url,source_provider_id').eq('organization_id', organizationId)),
  ]);
  if (enriched.error || contacted.error || drops.error || saved.error) throw new LeadDropsError('No pudimos leer los contactos del equipo.', 503);
  const lower = (value: unknown) => String(value || '').trim().toLowerCase();
  return {
    emails: new Set([...(enriched.data || []), ...(contacted.data || []), ...(saved.data || [])].map((row: any) => lower(row.email)).filter(Boolean)),
    linkedins: new Set([...(enriched.data || []), ...(saved.data || [])].map((row: any) => lower(row.linkedin_url).replace(/\/$/, '')).filter(Boolean)),
    leadIds: new Set([
      ...[...(enriched.data || []), ...(saved.data || [])].map((row: any) => String(row.source_provider_id || '')),
      ...(drops.data || []).flatMap((row: any) => (Array.isArray(row.items) ? row.items : []).map((item: any) => String(item?.leadId || ''))),
    ].filter(Boolean)),
  };
}

/** An http(s) address as the report links it, or nothing: a bare domain («ripley.cl») gets its https. */
function webUrl(value: unknown) {
  const raw = text(value, 500);
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A Leads Finder result as a candidate: what the screen may show, and the email and LinkedIn only as keys to skip known
 * people. The title with its linking words in lower case, the company with its legal form («S.A.») and the industry in
 * Spanish («logistics & supply chain» → «Logística»), as the screen, the email and the PDF say them; the level and the
 * area in Spanish too. The company's site and LinkedIn page are public; the person's LinkedIn is not shown before saving.
 */
function candidateOf(entry: VaultEntry): DropCandidate {
  const { lead, contact } = entry;
  const domain = text(lead.organization_domain, 253) || null;
  // Apollo's free search says whether it has the email, without it: it is looked up on saving (1 credit), and the phone is not offered.
  const apollo = !isLeadsFinderId(lead.id);
  return {
    leadId: lead.id, name: text(contact.fullName, 200) || text(lead.name, 200), title: tidyTitle(text(lead.title, 160)),
    company: tidyCompany(text(lead.organization_name, 200)), domain,
    industry: industryLabel(text(lead.organization_industry, 160)), size: typeof lead.organization_size === 'number' ? lead.organization_size : null,
    city: text(lead.city, 160) || null, state: text(lead.state, 160) || null, country: text(lead.country, 160) || null,
    seniority: seniorityLabel(text(lead.seniority, 60)), department: departmentLabel(text(Array.isArray(lead.departments) ? lead.departments[0] : '', 60)),
    website: webUrl(lead.organization?.website_url) || webUrl(domain), companyLinkedin: webUrl(lead.organization?.linkedin_url),
    hasEmail: Boolean(contact.email) || (apollo && (lead as { has_email?: unknown }).has_email === true), hasPhone: !apollo && Boolean(contact.mobileNumber),
    emailKey: contact.email ? contact.email.toLowerCase() : null, linkedinKey: contact.linkedinUrl ? contact.linkedinUrl.toLowerCase().replace(/\/$/, '') : null,
    about: text(lead.organization?.short_description, 600) || null,
    ...(apollo ? { provider: 'apollo' as const } : {}),
  };
}

/**
 * Apollo's people as the vault keeps a person, so the drops treat both searches alike: the person as the search shows them
 * (the surname hidden, «Ni***o»), no email nor phone (Apollo gives them on enrichment), and the LinkedIn only as a key to
 * skip known people.
 */
export function apolloDropEntries(people: unknown[]): VaultEntry[] {
  return people.flatMap(value => {
    const person = (value && typeof value === 'object' ? value : {}) as Record<string, any>;
    const id = text(person.id || person.apollo_id, 64);
    if (!/^[0-9a-f]{24}$/i.test(id)) return [];
    const firstName = text(person.first_name, 100);
    const lastName = text(person.last_name || person.last_name_obfuscated, 100);
    const fullName = text(person.name, 200) || [firstName, lastName].filter(Boolean).join(' ');
    const organization = (person.organization && typeof person.organization === 'object' ? person.organization : {}) as Record<string, any>;
    const lead = {
      id, name: fullName, title: text(person.title, 160), organization_name: text(person.organization_name || organization.name, 200),
      organization_domain: text(person.organization_domain || organization.domain || organization.primary_domain, 253),
      organization_industry: text(person.organization_industry || organization.industry, 160),
      organization_size: typeof person.organization_size === 'number' ? person.organization_size : typeof organization.estimated_num_employees === 'number' ? organization.estimated_num_employees : null,
      city: text(person.city, 160), state: text(person.state, 160), country: text(person.country, 160), seniority: text(person.seniority, 60),
      departments: Array.isArray(person.departments) ? person.departments.filter((item: unknown) => typeof item === 'string').slice(0, 5) : [],
      organization: { website_url: text(organization.website_url, 500), linkedin_url: text(organization.linkedin_url, 500), short_description: text(organization.short_description, 1000) },
      has_email: person.has_email === true,
    };
    const contact = { fullName, firstName, lastName, email: null, personalEmail: null, mobileNumber: null, linkedinUrl: text(person.linkedin_url, 500) || null, emailStatus: null };
    return [{ lead: lead as unknown as VaultEntry['lead'], contact: contact as VaultEntry['contact'] }];
  });
}

/** How many people one Apollo search of a drop may bring: ten pages of a hundred at most (apolloDropDepth), each a free call. */
const APOLLO_DROP_SEARCH_MAX = 1000;
/**
 * How far down Apollo's list the finder's first search goes (15 Nov 2026). Apollo answers a search in the same order every day, so
 * a team that already has the first people would be told there is nobody new while thousands wait further down (GrupoExpro's
 * customer: 12 700 people with a verified email in Chile, and the search read the first 300). It asks for as many more as the team
 * already has (saved, contacted or recommended in six months), by hundreds, up to APOLLO_DROP_SEARCH_MAX.
 */
export const apolloDropDepth = (base: number, known: number) => Math.min(APOLLO_DROP_SEARCH_MAX, base + Math.ceil(Math.max(0, known) / 100) * 100);
/** Apollo's free people search, for a drop: a page of up to 100 people, or the next ones too when more are asked, at no cost. */
export const searchApolloDrops: Search = async input => {
  const found: any = await executeProviderLeadSearch({ ...input, provider: 'apollo' as LeadSearchInput['provider'], maxResults: Math.min(APOLLO_DROP_SEARCH_MAX, input.maxResults) }, getGatewayConfig());
  return { results: apolloDropEntries(Array.isArray(found?.leads) ? found.leads : []), costUsd: 0 };
};

/**
 * The search for a customer. Its industries go as the actor names them; one it does not know is left out, because as a
 * company keyword it would leave almost nobody («seguridad privada» next to «retail»). `broad`: the titles and places only.
 */
const searchInput = (criteria: DropCriteria, count: number, broad = false): LeadSearchInput => ({
  provider: 'apollo' as LeadSearchInput['provider'], searchMode: 'batch', revealEmail: false, revealPhone: false, organizationDomains: [],
  titles: criteria.titles, seniorities: [], companyKeywords: [], companyLocations: [],
  industryKeywords: broad ? [] : [...new Set(criteria.industries.map(leadsFinderIndustry).filter((value): value is string => Boolean(value)))],
  personLocations: criteria.locations, employeeRanges: broad ? [] : criteria.sizes, includeSimilarTitles: true, maxResults: count,
});

/**
 * A customer's industries as Apollo can be asked for them (16 Nov 2026): the ones it has a tag for go together, and the rest go as
 * words of the company in a search of their own, since a tag and a word in the same search leave almost nobody. Until then an
 * industry the provider's list does not name («forestal», «celulosa», «puertos») was left out of the search without saying.
 */
export function industrySets(criteria: DropCriteria): string[][] {
  const named = [...new Set(criteria.industries.map(value => leadsFinderIndustry(value) || value.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean))];
  const tagged = named.filter(name => resolveApolloIndustryFilters([name]).tagIds.length > 0);
  const worded = named.filter(name => !tagged.includes(name));
  return [tagged, worded].filter(set => set.length > 0);
}
/** The heads of a company (one or two a company): a search by them lists the companies of an industry, not the staff of the largest. */
const COMPANY_HEADS = ['owner', 'founder', 'c_suite'];

/** What the company's customer is chosen from: its «Ficha de la empresa», the team (admins first, for ties) and what it saved. */
async function teamOf(client: Client, organizationId: string) {
  const [members, saved]: any[] = await Promise.all([
    client.from('organization_members').select('user_id,role').eq('organization_id', organizationId),
    client.from('enriched_leads').select('title,organization_industry').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(1000),
  ]);
  if (members.error || saved.error) throw new LeadDropsError('No pudimos leer el equipo.', 503);
  const memberIds = (members.data || []).map((row: any) => String(row.user_id));
  const [profiles, company]: [any, Awaited<ReturnType<typeof readCompanyFields>>] = await Promise.all([
    memberIds.length ? client.from('profiles').select('id,full_name,company_name,company_domain,job_title,signatures').in('id', memberIds) : { data: [] },
    readCompanyFields(client, organizationId),
  ]);
  if (profiles.error) throw new LeadDropsError('No pudimos leer los perfiles.', 503);
  const byId = new Map<string, any>(((profiles.data || []) as any[]).map(row => [String(row.id), row]));
  const rank = (id: string) => ['owner', 'admin'].includes(String((members.data || []).find((row: any) => String(row.user_id) === id)?.role)) ? 0 : 1;
  const team: string[] = memberIds.slice().sort((a: string, b: string) => rank(a) - rank(b));
  const savedRows = ((saved.data || []) as any[]).map(row => ({ title: row.title, industry: row.organization_industry }));
  return { byId, team, savedRows, company };
}
type Team = Awaited<ReturnType<typeof teamOf>>;
/** The company's customer (companyDropCriteria): for whoever did not declare one of their own. */
const customerOf = ({ byId, team, savedRows, company }: Team) => companyDropCriteria(
  company ? { roles: company.targetRoles, industries: company.targetIndustries, locations: company.targetLocations, size: company.targetCompanySize } : null,
  team.map(id => declaredOf(byId.get(id))), savedRows);
/** A person's customer: their «Perfil»'s, else the company's. */
const customerFor = (team: Team, userId: string, company: DropCriteria | null = customerOf(team)) => personDropCriteria(declaredOf(team.byId.get(userId)), company);
/** How many a search asks for: twice what the group needs and some more (some are known already, some have no email), ten at least. */
const searchCount = (people: number, size = DEFAULT_DROP_PLAN.size) => Math.max(10, Math.min(100, people * size * 2 + 5));

/**
 * Audit B3 (1 Nov 2026): of 109 «Contacto del día» sent in 30 days, 14 were opened. Whoever left the last six unopened (two weeks of
 * Tuesday, Wednesday and Friday) gets a rest of two weeks from the last one; then one more, and opening it brings the rhythm back.
 * «Hoy» still offers one at any time (pullDrop), so nobody loses it.
 */
export const UNOPENED_TO_PAUSE = 6;
export const PAUSE_DAYS = 14;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86_400_000);
export function restingFromDrops(sent: Array<{ drop_date: string; opened_at: string | null; saved_at: string | null }>, today: string) {
  const recent = [...sent].sort((a, b) => b.drop_date.localeCompare(a.drop_date)).slice(0, UNOPENED_TO_PAUSE);
  if (recent.length < UNOPENED_TO_PAUSE || recent.some(drop => drop.opened_at || drop.saved_at)) return false;
  return daysBetween(recent[0].drop_date, today) < PAUSE_DAYS;
}
/**
 * Who among `people` is resting (restingFromDrops). A failed read rests nobody: the morning run goes on as before. `startOf`: the day
 * a person's own plan began; what they left unopened before it does not count, so they start again with it.
 */
export async function restingPeople(client: Client, people: string[], now: Date, startOf?: Map<string, string>): Promise<Set<string>> {
  const today = dayInZone(now);
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
  const resting = new Set<string>();
  for (let start = 0; start < people.length; start += 200) {
    const rows: any = await client.from('lead_drops').select('user_id,drop_date,opened_at,saved_at').in('user_id', people.slice(start, start + 200))
      .eq('status', 'sent').gte('drop_date', since).limit(5000);
    if (rows.error) return new Set();
    const byUser = new Map<string, any[]>();
    for (const row of rows.data || []) {
      const from = startOf?.get(String(row.user_id));
      if (from && String(row.drop_date) < from) continue;
      byUser.set(String(row.user_id), [...(byUser.get(String(row.user_id)) || []), row]);
    }
    for (const [userId, sent] of byUser) if (restingFromDrops(sent, today)) resting.add(userId);
  }
  return resting;
}

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const sameValues = (a: string[], b: string[]) => a.length === b.length && a.map(fold).sort().join('|') === b.map(fold).sort().join('|');
const capitalize = (value: string) => value ? value[0].toUpperCase() + value.slice(1) : value;
/**
 * What the search that found a contact kept to, for the person's own customer (a group shares the group's): the industries
 * only when Apollo knows each one by its tag (a keyword is looser), the sizes, and the places, which every search keeps to.
 */
function keptBySearch(searched: DropCriteria, mine: DropCriteria, narrow: boolean) {
  const industries = [...new Set(searched.industries.map(leadsFinderIndustry).filter((value): value is string => Boolean(value)))];
  return {
    industry: narrow && industries.length > 0 && sameValues(searched.industries, mine.industries)
      && industries.length === searched.industries.length && industries.every(name => resolveApolloIndustryFilters([name]).tagIds.length > 0),
    size: narrow && searched.sizes.length > 0 && sameValues(searched.sizes, mine.sizes),
    place: searched.locations.length > 0 && sameValues(searched.locations, mine.locations),
  };
}

/** Why a drop came empty, as it is kept; `emptyReason` says it to the person. */
const NO_CUSTOMER = 'Sin cliente ideal en «Perfil» ni contactos guardados para inferirlo.';
const NO_BUDGET = 'Se acabó el presupuesto del mes para el contacto del día.';
const TOO_FEW = 'La búsqueda no trajo contactos nuevos con correo.';
const NOBODY = 'La búsqueda no encontró personas con correo verificado para ese cliente ideal.';
/** A drop that came empty for lack of a customer: nothing was searched, so it is made again once there is one. */
const withoutCustomer = (drop: { status: string; criteria?: unknown }) => drop.status === 'empty' && !Array.isArray((drop.criteria as DropCriteria | null)?.titles);

// ─── The finder: teams with several contacts a day (lead-drop-finder.ts) ───────────────────────────────────────────

/** What the finder's first search asks for, and each of its two extra ones (the roles as people write them, the words of their area). */
const FINDER_BASE = 300;
const FINDER_EXTRA = 100;
/** What one group's search, classification and score may take at worst (ten pages twice, its companies opened, and the model's timeouts). */
export const FINDER_GROUP_MS = 120_000;
const GROUP_MS = FINDER_GROUP_MS;
const criteriaKey = (criteria: DropCriteria) => [criteria.titles, criteria.industries, criteria.locations, criteria.sizes].map(values => values.map(fold).sort().join(',')).join('|');

/** What the team did with the contacts of its drops of the last six months (dropLessons); nothing when it cannot be read. */
async function readDropLessons(client: Client, organizationId: string, now: Date): Promise<FinderLessons & { wishesOf: (userId: string) => string[] }> {
  const since = new Date(now.getTime() - 180 * DAY).toISOString().slice(0, 10);
  const rows: any = await client.from('lead_drops').select('user_id,items').eq('organization_id', organizationId).gte('drop_date', since).limit(2000);
  const read = rows.error ? [] : rows.data || [];
  // What each person asked for when saying whether a contact was useful: theirs alone, the finder's score reads it for them.
  return { ...dropLessons(read), wishesOf: userId => dropWishes(read, userId) };
}
/** «En tus palabras» of a person's «Perfil» as it is stored (signatures.profile_extended.targetNotes). */
const ownNotes = (profile: Record<string, unknown> | null | undefined) => {
  const signatures = profile?.signatures as Record<string, unknown> | null | undefined;
  const extended = signatures && typeof signatures === 'object' ? signatures.profile_extended as Record<string, unknown> | null | undefined : null;
  return profileTargetNotes(extended && typeof extended === 'object' ? extended.targetNotes : null);
};
/** Two people with the same customer and different words are scored apart: what each wrote is theirs. */
const preferencesKey = (preferences: FinderPreferences) => [preferences.notes || '', preferences.teamNotes || '', ...(preferences.wishes || [])].join('¦');

/** What a person sells, as Cowork reads it: for the scores of the finder. */
async function sellerFor(client: Client, organizationId: string, userId: string): Promise<FinderSeller | null> {
  const context = await loadCoworkUserContext(client, { organizationId, userId }, { memories: false, mailbox: false }).catch(() => null);
  return context ? { company: context.companyName, offer: context.offer, services: context.services, differentiators: context.differentiators, sector: context.sector } : null;
}

/**
 * The finder's choice for a group: every usable candidate scored for each person's customer (one scoring per different customer,
 * with what that person sells), then the picker by score with its slots for roles next to the customer's.
 */
async function finderPicks(client: Client, organizationId: string, input: {
  candidates: DropCandidate[]; members: string[]; known: KnownPeople; size: number; own: (userId: string) => DropCriteria; lessons: FinderLessons; generate?: Generate;
  /** What each person says they look for, in their words: read by the score, so the same search serves each one differently. */
  preferences?: (userId: string) => FinderPreferences;
  /** What a person sells, read once for the group (sellerFor). */
  seller?: (userId: string) => Promise<FinderSeller | null>;
  /** The score a candidate's company already has for this customer (lead-drop-accounts.ts): the score of the person starts from it. */
  accountOf?: (candidate: DropCandidate) => { score: number; reason: string | null } | null;
}) {
  const usable = usableDrops(input.candidates, input.known);
  const scores = new Map<string, Map<string, DropScore>>();
  const customers = new Map<string, { criteria: DropCriteria; userId: string }>();
  const preferencesOf = (userId: string): FinderPreferences => input.preferences?.(userId) ?? {};
  const keyOf = (userId: string) => `${criteriaKey(input.own(userId))}¦${preferencesKey(preferencesOf(userId))}`;
  for (const userId of input.members) if (!customers.has(keyOf(userId))) customers.set(keyOf(userId), { criteria: input.own(userId), userId });
  await Promise.all([...customers].map(async ([key, { criteria, userId }]) => {
    const seller = await (input.seller ?? (id => sellerFor(client, organizationId, id)))(userId);
    scores.set(key, await scoreDropCandidates({ candidates: usable, criteria, seller, lessons: input.lessons, preferences: preferencesOf(userId), generate: input.generate,
      accountOf: input.accountOf }).catch(() => new Map<string, DropScore>()));
  }));
  const scoreOf = (userId: string, leadId: string) => scores.get(keyOf(userId))?.get(leadId) ?? null;
  const picks = pickRankedDrops(usable, input.members, input.known, input.size, { criteriaOf: input.own, scoreOf: (userId, item) => scoreOf(userId, item.leadId) });
  return { picks, scoreOf };
}

/**
 * Plans today's drops of an organization for the people given: each person's customer (their «Perfil»'s, else the company's),
 * one Leads Finder search per group of people with similar customers (groupDropPeople, at most dropsMaxGroups), a different
 * contact for each person (as many as the team's plan says) chosen by their own customer, kept in the vault and in a «pending» drop that `writeDrop`
 * completes. Without a customer to go by, or when the month's budget ran out, each gets an «empty» drop with the reason, so
 * later runs do not try again.
 */
export async function planOrganizationDrops(client: Client, organizationId: string, people: string[], deps: {
  now: Date; search?: Search; budgetUsd: number; spentUsd: number; usdPerLead?: number; provider?: 'apollo' | 'apify';
  /** Today's rows exist already, «pending» and empty, taken by `pullDrop` before searching: they are completed, not added. */
  claimed?: boolean;
  /** What the team gets (dropPlanFor); read here when the caller did not. */
  plan?: DropPlan;
  /** The model the finder asks (a team with several contacts a day); the default one when the caller gives none. */
  generate?: Generate;
  /**
   * How long the caller still has, in ms (the cron's run). With several searches to make, one is not started with less than
   * GROUP_MS left once another was made: its people get no row today yet, so the next run plans them.
   */
  timeLeft?: () => number;
  /**
   * Someone is waiting for the answer on screen («Hoy», pullDrop): the companies already known are opened, half as many, and no
   * new ones are looked for or scored, nor the search widened to other industries. The morning run does all of that.
   */
  quick?: boolean;
}) {
  const today = dayInZone(deps.now);
  const plan = deps.plan ?? await dropPlanFor(client, organizationId);
  const apollo = (deps.provider ?? dropsProvider()) === 'apollo';
  // Several contacts a day: the finder searches more ways, scores each candidate and keeps some slots to explore (lead-drop-finder.ts).
  const finder = apollo && plan.size > 1;
  const search = deps.search ?? (apollo ? searchApolloDrops : searchLeadsFinder);
  const usdPerLead = deps.usdPerLead ?? (apollo ? 0 : leadsFinderUsdPerLead());
  const team = await teamOf(client, organizationId);

  // One search per group of people with similar customers.
  const results: Array<{ userId: string; status: 'pending' | 'empty'; error?: string; items?: PendingItem[]; cost?: number; criteria?: DropCriteria }> = [];
  const company = people.length ? customerOf(team) : null;
  const own = new Map(people.map(userId => [userId, customerFor(team, userId, company)]));
  for (const userId of people) if (!own.get(userId)) results.push({ userId, status: 'empty', error: NO_CUSTOMER });
  const groups = groupDropPeople(people.filter(userId => own.get(userId)).map(userId => ({ id: userId, criteria: own.get(userId)! })), dropsMaxGroups());

  const known = groups.length ? await knownPeople(client, organizationId, deps.now) : { emails: new Set<string>(), linkedins: new Set<string>(), leadIds: new Set<string>() };
  const lessons = finder && groups.length ? await readDropLessons(client, organizationId, deps.now) : { liked: [], disliked: [], wishesOf: () => [] as string[] };
  const preferences = (userId: string): FinderPreferences => ({ notes: ownNotes(team.byId.get(userId)) || null, teamNotes: team.company?.targetNotes || null, wishes: lessons.wishesOf(userId) });
  let spent = deps.spentUsd;
  let searched = 0;
  for (const { criteria, people: members } of groups) {
    if (searched++ && deps.timeLeft && deps.timeLeft() < GROUP_MS) break;
    // Apollo's search is free: as many as one page brings, so the days ahead still find people the team does not have.
    const count = apollo ? (finder ? apolloDropDepth(FINDER_BASE, Math.max(known.leadIds.size, known.emails.size, known.linkedins.size)) : 100) : searchCount(members.length, plan.size);
    if (overBudget(spent, count, usdPerLead, deps.budgetUsd)) {
      for (const userId of members) results.push({ userId, status: 'empty', error: NO_BUDGET, criteria: own.get(userId)! });
      continue;
    }
    let found: Awaited<ReturnType<Search>>;
    // Who came from the search with the industries and sizes: they are within them, though Apollo may not say their industry or size.
    let narrowIds = new Set<string>();
    // The run's cap, not its cost (that comes from what it returns): one person's search is too small for a cap of its
    // own, which Apify refuses under its minimum, so never below an ordinary search's (leadsFinderMaxRunUsd).
    const searchDeps = (wanted: number) => ({ fetch: globalThis.fetch, token: process.env.APIFY_TOKEN, maxRunUsd: Math.max(leadsFinderMaxRunUsd(), Math.min(1, wanted * usdPerLead * 1.5)) });
    // The finder asks each kind of industry in a search of its own (industrySets); a team of one contact searches as before.
    const sets = finder ? industrySets(criteria) : [];
    const perSet = (input: LeadSearchInput): LeadSearchInput[] => (sets.length ? sets.map(set => ({ ...input, industryKeywords: set })) : [input]);
    const searchAll = async (inputs: LeadSearchInput[], wanted: number): Promise<Awaited<ReturnType<Search>>> => {
      const answers = await Promise.all(inputs.map(input => search(input, searchDeps(wanted))));
      const seen = new Set<string>();
      return { results: answers.flatMap(answer => answer.results).filter(entry => !seen.has(entry.lead.id) && Boolean(seen.add(entry.lead.id))),
        costUsd: answers.reduce((sum, answer) => sum + answer.costUsd, 0) };
    };
    try {
      const narrow = searchInput(criteria, count);
      found = await searchAll(perSet(narrow), count);
      narrowIds = new Set(found.results.map(entry => entry.lead.id));
      // Nobody with those industries or sizes: once more with the titles and places only.
      if (!found.results.length && (narrow.industryKeywords.length || sets.length || narrow.employeeRanges.length)) {
        const broad = await search(searchInput(criteria, count, true), searchDeps(count));
        found = { ...broad, costUsd: found.costUsd + broad.costUsd };
      }
    } catch (error) {
      for (const userId of members) results.push({ userId, status: 'empty', error: `La búsqueda falló: ${text((error as Error)?.message, 200)}`, criteria: own.get(userId)! });
      continue;
    }
    spent += found.costUsd;
    const entries = new Map<string, VaultEntry>(found.results.map(entry => [entry.lead.id, entry]));
    let scoreOf: (userId: string, leadId: string) => DropScore | null = () => null;
    let assigned: Map<string, Array<DropCandidate & { track?: 'explore'; role?: 'refer' }>>;
    // By company (lead-drop-accounts.ts): what is told of the search, why each company, and who came from an industry next to the customer's.
    let accountsNote: DropCriteria['accounts'];
    // What the finder did for this customer, in counts (DropCriteria.trace): kept with each drop, for whoever reviews the run.
    const trace: Record<string, number | boolean> = {};
    const groupStarted = Date.now();
    const companyWhy = new Map<string, string>();
    const expandedIds = new Map<string, string>();
    if (finder) {
      // The same customer asked two more ways (free): its roles as people write them, and the words of their area as a title.
      const terms = await finderSearchTerms(criteria, deps.generate).catch(() => ({ titles: [] as string[], keywords: [] as string[] }));
      const extra = await Promise.all([
        terms.titles.length ? searchAll(perSet(searchInput({ ...criteria, titles: terms.titles }, FINDER_EXTRA)), FINDER_EXTRA).catch(() => null) : null,
        terms.keywords.length ? searchAll(perSet({ ...searchInput({ ...criteria, titles: terms.keywords }, FINDER_EXTRA), includeSimilarTitles: false }), FINDER_EXTRA).catch(() => null) : null,
      ]);
      trace.narrow = narrowIds.size; trace.broad = found.results.length > 0 && narrowIds.size === 0;
      for (const more of extra) for (const entry of more?.results || []) if (!entries.has(entry.lead.id)) { entries.set(entry.lead.id, entry); narrowIds.add(entry.lead.id); }
      trace.terms = terms.titles.length + terms.keywords.length; trace.extra = narrowIds.size - Number(trace.narrow);

      // ── By company: the customer's companies found, scored once, and the best ones opened to bring their people ──
      const quiet = (inputs: LeadSearchInput[], wanted: number) => searchAll(inputs, wanted).then(answer => answer.results).catch(() => null);
      const customerKey = createHash('sha1').update(criteriaKey(criteria)).digest('hex').slice(0, 16);
      const sellers = new Map<string, Promise<FinderSeller | null>>();
      const seller = (userId: string) => sellers.get(userId) ?? sellers.set(userId, sellerFor(client, organizationId, userId)).get(userId)!;
      const teamWords: FinderPreferences = { notes: preferences(members[0]).notes, teamNotes: preferences(members[0]).teamNotes };
      const accounts = await readAccounts(client, organizationId, customerKey);
      trace.known = accounts.size;
      const touched = new Set<string>(), opened = new Set<string>();
      const accountFor = (domain: unknown) => accounts.get(accountDomain(domain) || '') ?? null;
      const learn = (list: DropAccount[]) => {
        for (const account of list) {
          const kept = accounts.get(account.domain);
          if (kept) { kept.about ||= account.about; kept.industry ||= account.industry; kept.size ??= account.size; }
          else { accounts.set(account.domain, account); touched.add(account.domain); }
        }
      };
      const scoreNew = async () => {
        const pending = [...accounts.values()].filter(account => account.score === null);
        if (!pending.length) return;
        await scoreAccounts({ accounts: pending, criteria, seller: await seller(members[0]), lessons, preferences: teamWords, generate: deps.generate, now: deps.now }).catch(() => 0);
        for (const account of pending) if (account.score !== null) touched.add(account.domain);
      };
      const take = (entry: VaultEntry) => {
        if (entries.has(entry.lead.id)) return;
        const account = accountFor(entry.lead.organization_domain);
        entries.set(entry.lead.id, entry);
        if (account?.origin === 'expansion') expandedIds.set(entry.lead.id, account.segment || 'rubro vecino');
        else narrowIds.add(entry.lead.id);
      };
      // A company opened: everyone the search has there in the customer's places, whatever the title (four companies at a time), and
      // the customer's roles across all of them, which a large company would otherwise hide among its first hundred people.
      const open = async (list: DropAccount[]) => {
        if (!list.length) return;
        const base = searchInput(criteria, 100, true);
        const roles = [...new Set([...criteria.titles, ...terms.titles])].slice(0, 20);
        const asked = quiet([{ ...searchInput({ ...criteria, titles: roles }, FINDER_BASE, true), organizationDomains: list.map(account => account.domain) }], FINDER_BASE);
        for (let start = 0; start < list.length; start += 4) {
          const batch = list.slice(start, start + 4);
          const staff = await Promise.all(batch.map(account => quiet([{ ...base, titles: [], includeSimilarTitles: false, organizationDomains: [account.domain] }], 100)));
          staff.forEach((people, index) => {
            // A search that failed says nothing of the company: it is opened again another day.
            if (!people) return;
            for (const entry of people) take(entry);
            batch[index].openedAt = deps.now.toISOString(); touched.add(batch[index].domain); opened.add(batch[index].domain);
          });
        }
        for (const entry of await asked || []) take(entry);
      };
      // With little of the run left the companies wait for the next one: the drop is made by role, as before.
      const hurried = Boolean(deps.timeLeft && deps.timeLeft() < GROUP_MS - 20_000);
      trace.hurried = hurried;
      if (!deps.quick && !hurried) {
        if (sets.length) {
          const heads = await quiet(perSet({ ...searchInput(criteria, FINDER_BASE), titles: [], seniorities: COMPANY_HEADS, includeSimilarTitles: false }), FINDER_BASE);
          for (const entry of heads || []) if (!entries.has(entry.lead.id)) { entries.set(entry.lead.id, entry); narrowIds.add(entry.lead.id); }
        }
        learn(accountsOf([...entries.values()].filter(entry => narrowIds.has(entry.lead.id))));
        trace.learnt = touched.size;
        await scoreNew();
      }
      if (!hurried) await open(accountsToOpen([...accounts.values()].filter(account => account.origin === 'customer'), deps.now, deps.quick ? ACCOUNTS_OPENED / 2 : ACCOUNTS_OPENED));

      // Too few people the team does not have yet: the titles and places only, before choosing, so the score reads them all at once.
      const needed = members.length * plan.size * 3;
      if (usableDrops([...entries.values()].map(candidateOf), known).length < needed) {
        const wider = await search(searchInput(criteria, count, true), searchDeps(count)).catch(() => null);
        for (const entry of wider?.results || []) if (!entries.has(entry.lead.id)) entries.set(entry.lead.id, entry);
      }
      const accountOf = (candidate: DropCandidate) => { const account = accountFor(candidate.domain); return account && account.score !== null ? { score: account.score, reason: account.reason } : null; };
      const choose = () => finderPicks(client, organizationId, { candidates: [...entries.values()].map(candidateOf), members, known, size: plan.size,
        own: userId => own.get(userId)!, lessons, preferences, generate: deps.generate, seller, accountOf });
      let chosen = await choose();
      const worth = () => usableDrops([...entries.values()].map(candidateOf), known).filter(item => members.some(userId => chosen.scoreOf(userId, item.leadId)));
      // The customer's own industries have less than two days of people worth offering: the industries next to them (expansionIndustries),
      // and of those only the people of the companies that fit. Said in the drop, so nobody takes them for a mistake.
      if (!deps.quick && worth().length < members.length * plan.size * 2 && (!deps.timeLeft || deps.timeLeft() > GROUP_MS)) {
        const next = await expansionIndustries({ criteria, seller: await seller(members[0]), lessons, preferences: teamWords, generate: deps.generate }).catch(() => []);
        const fresh: VaultEntry[] = [];
        for (const { industry, keywords } of next) {
          const base = { ...searchInput(criteria, FINDER_EXTRA, true), companyKeywords: keywords };
          const [roles, heads] = await Promise.all([quiet([base], FINDER_EXTRA), quiet([{ ...base, titles: [], seniorities: COMPANY_HEADS, includeSimilarTitles: false }], FINDER_EXTRA)]);
          const people = [...(roles || []), ...(heads || [])].filter(entry => !entries.has(entry.lead.id));
          learn(accountsOf(people, 'expansion', industry));
          fresh.push(...people);
        }
        await scoreNew();
        const before = entries.size;
        for (const entry of fresh) if ((accountFor(entry.lead.organization_domain)?.score ?? -1) >= ACCOUNT_FIT) take(entry);
        await open(accountsToOpen([...accounts.values()].filter(account => account.origin === 'expansion'), deps.now, 6));
        if (entries.size > before) chosen = await choose();
      }
      found = { ...found, results: [...entries.values()] };
      assigned = chosen.picks;
      scoreOf = chosen.scoreOf;
      // Whoever the score left with nobody (the model down, or no title it knows) gets them as a team of one contact does, by the words of the title.
      const without = members.filter(userId => !(assigned.get(userId) || []).length);
      if (without.length) {
        const taken = new Set([...assigned.values()].flat().map(pick => pick.leadId));
        const plain = assignDrops(found.results.map(candidateOf).filter(item => !taken.has(item.leadId)), without, known, criteria, plan.size, userId => own.get(userId)!);
        for (const [userId, picks] of plain) if (picks.length) assigned.set(userId, picks);
      }
      // What was learnt of the companies opened: how many people worth offering each still has after today, so one that ran out
      // rests and the next ones get their turn. Only when the score answered: without it nobody would look worth offering.
      const stock = worth();
      if (stock.length) {
        const picked = new Set([...assigned.values()].flat().map(pick => pick.leadId));
        const left = new Map<string, number>();
        for (const item of stock) { const domain = accountDomain(item.domain); if (domain && !picked.has(item.leadId)) left.set(domain, (left.get(domain) || 0) + 1); }
        for (const domain of opened) accounts.get(domain)!.peopleLeft = left.get(domain) || 0;
      }
      const saved = await saveAccounts(client, organizationId, customerKey, [...touched].map(domain => accounts.get(domain)!), deps.now);
      const fitting = [...accounts.values()].filter(account => (account.score ?? -1) >= ACCOUNT_FIT);
      Object.assign(trace, { accounts: accounts.size, scored: [...accounts.values()].filter(account => account.score !== null).length, fit: fitting.length,
        opened: opened.size, touched: touched.size, saved, candidates: entries.size, worth: stock.length, plain: without.length, ms: Date.now() - groupStarted });
      if (fitting.length) accountsNote = { fit: fitting.length, opened: opened.size };
      for (const account of fitting) if (account.reason) companyWhy.set(account.domain, account.reason);
    } else {
      assigned = assignDrops(found.results.map(candidateOf), members, known, criteria, plan.size, userId => own.get(userId)!);
    }
    // Plan de uso A5 (audit B3): the same search every day ends up bringing only people already known; 29 drops came empty that
    // way at the end of October. Then once more, wider: the titles and places only, and further down the list (three times as
    // many). Each contact's fit (dropFit) shows what no longer matches, the industry or the size. A failure leaves it as before.
    const waiting = members.filter(userId => !(assigned.get(userId) || []).length);
    const deeper = Math.min(LEADS_FINDER_MAX_PER_RUN, count * 3);
    if (!finder && waiting.length && found.results.length && deeper > count && !overBudget(spent, deeper, usdPerLead, deps.budgetUsd)) {
      try {
        const wider = await search(searchInput(criteria, deeper, true), searchDeps(deeper));
        spent += wider.costUsd;
        found = { ...found, costUsd: found.costUsd + wider.costUsd };
        const taken = new Set([...assigned.values()].flat().map(pick => pick.leadId));
        for (const entry of wider.results) if (!entries.has(entry.lead.id)) entries.set(entry.lead.id, entry);
        const more = assignDrops(wider.results.map(candidateOf).filter(item => !taken.has(item.leadId)), waiting, known, criteria, plan.size, userId => own.get(userId)!);
        for (const [userId, picks] of more) if (picks.length) assigned.set(userId, picks);
      } catch {
        // The wider search failed: those people keep the empty drop and its reason, as before.
      }
    }
    const share = members.length ? Math.round((found.costUsd / members.length) * 10_000) / 10_000 : 0;
    for (const userId of members) {
      // What the person sees and keeps is their own customer, not the group's search.
      const mine = own.get(userId)!;
      const picks = assigned.get(userId) || [];
      if (!picks.length) { results.push({ userId, status: 'empty', error: found.results.length ? TOO_FEW : NOBODY, cost: share, criteria: mine }); continue; }
      for (const pick of picks) { known.leadIds.add(pick.leadId); if (pick.emailKey) known.emails.add(pick.emailKey); }
      // Leads Finder's people wait in the vault with their email; Apollo's have none to keep yet.
      const vaulted = picks.map(pick => entries.get(pick.leadId)).filter((entry): entry is VaultEntry => Boolean(entry) && isLeadsFinderId(entry!.lead.id));
      if (vaulted.length) await storeInVault(client, { organizationId, userId, entries: vaulted, now: deps.now.getTime() });
      // The industries next to theirs this person's contacts came from, if any: said with how the search went.
      const widened = [...new Set(picks.map(pick => expandedIds.get(pick.leadId)).filter((industry): industry is string => Boolean(industry)))];
      const searched = { ...mine, ...(accountsNote ? { accounts: { ...accountsNote, ...(widened.length ? { expanded: widened } : {}) } } : {}),
        ...(Object.keys(trace).length ? { trace } : {}) };
      results.push({ userId, status: 'pending', cost: share, criteria: searched, items: picks.map(pick => {
        // The industry as the actor names it: «servicios transitorios» searched as «staffing & recruiting» fits «Reclutamiento y personal».
        const actorIndustry = text(entries.get(pick.leadId)?.lead.organization_industry, 160).toLowerCase();
        const { emailKey: _email, linkedinKey: _linkedin, about, ...shown } = pick;
        const kept = keptBySearch(criteria, mine, narrowIds.has(pick.leadId));
        // One industry searched by its tag and none said: it is that one.
        const person = !shown.industry && kept.industry && mine.industries.length === 1 ? { ...shown, industry: capitalize(mine.industries[0]) } : shown;
        // The finder read the title by what it means: «Prevencionista de Riesgos» is the role asked as «Jefe de Prevención», whatever its words.
        const titleClass = scoreOf(userId, pick.leadId)?.titleClass;
        const fit = searchedFit(dropFit(person, mine, wanted => Boolean(actorIndustry) && leadsFinderIndustry(wanted) === actorIndustry), kept)
          .map(entry => entry.criterion === 'Cargo' && titleClass && entry.match !== 'unknown' ? { ...entry, match: titleClass === 'related' ? 'partial' as const : 'yes' as const } : entry);
        // Why this company, as the finder scored it, and whether it came from an industry next to the customer's.
        const companyReason = companyWhy.get(accountDomain(pick.domain) || '');
        const neighbour = expandedIds.get(pick.leadId);
        const extras = { ...(companyReason ? { companyWhy: companyReason } : {}), ...(neighbour ? { expanded: neighbour } : {}) };
        return { ...person, ...extras, why: whyText({ ...person, ...extras }, mine, fit), research: researchFacts({ ...person, about: null }), draft: null, fit, description: about };
      }) });
    }
  }
  for (const result of results) {
    const row = { organization_id: organizationId, user_id: result.userId, drop_date: today, status: result.status, criteria: result.criteria || {},
      items: result.items || [], cost_usd: result.cost || 0, error: result.error?.slice(0, 300) || null };
    const written = deps.claimed
      ? await client.from('lead_drops').update({ ...row, updated_at: new Date().toISOString() }).eq('organization_id', organizationId).eq('user_id', result.userId)
        .eq('drop_date', today).eq('status', 'pending')
      : await client.from('lead_drops').insert(row);
    if (written.error && written.error.code !== '23505') throw new LeadDropsError('No pudimos guardar tu contacto del día.', 503);
  }
  return { planned: results.filter(item => item.status === 'pending').length, empty: results.filter(item => item.status === 'empty').length, spentUsd: spent - deps.spentUsd };
}

// ─── The research and the first email of each contact ──────────────────────────────────────────────────────────────

/** A contact while its drop is being written: the company's description as the search brought it, summarized in writeDrop. */
type PendingItem = DropItem & { description?: string | null };

const aboutSchema = z.object({ companies: z.array(z.object({ leadId: z.string(), about: z.string().max(220).nullable() }).strict()).max(10) }).strict();

/** What each company does, in one Spanish sentence, from the description the search brought; nothing when it brought none. */
async function summarizeCompanies(items: PendingItem[], generate: Generate) {
  const described = items.filter(item => item.description);
  if (!described.length) return new Map<string, string>();
  const answer = await generate({
    schema: aboutSchema, maxOutputTokens: 1200, timeoutMs: 25_000, openAiModel: process.env.LEAD_DROPS_RESEARCH_MODEL || 'claude-haiku-5-5', reasoningEffort: 'low',
    systemPrompt: 'Resumes en una frase en español de Chile qué hace cada empresa, solo con su descripción. Sin adjetivos de marketing ni datos que la descripción no diga. Responde JSON conforme al contrato.',
    prompt: JSON.stringify({ companies: described.map(item => ({ leadId: item.leadId, company: item.company, industry: item.industry, description: item.description })) }),
  }).catch(() => null);
  return new Map<string, string>(((answer?.companies || []) as Array<{ leadId: string; about: string | null }>).filter(item => item.about).map(item => [item.leadId, text(item.about, 220)]));
}

// Loose limits: one long reason must not lose the rest (the request from «Hoy» has one attempt); a long one is left out after.
const adviceSchema = z.object({ contacts: z.array(z.object({
  leadId: z.string(), reasons: z.array(z.string().max(1000)).max(5), approach: z.string().max(1000).nullable(),
}).strict()).max(10) }).strict();
const ADVICE_PROMPT = 'Le explicas a un vendedor por qué le recomiendas cada contacto. Por cada uno: de 2 a 3 razones (reasons), una frase de hasta 200 caracteres cada una, '
  + 'que conecten lo que vende (seller) con el cargo, el área y la empresa del contacto: qué problema de esa persona resuelve, por qué su empresa lo necesitaría y '
  + 'por qué su cargo decide o influye en esa compra. Y una sugerencia breve de cómo abrir la conversación (approach), sin redactar el correo. Usa solo los datos dados: '
  + 'no inventes cifras, clientes, noticias ni hechos de la empresa que su descripción no diga; lo que no se sabe se dice como lo que ese cargo suele resolver, '
  + 'sin decir que falta información ni que algo «no está especificado». '
  + 'No repitas como razón que calza por cargo, rubro o lugar: eso ya se muestra. Español de Chile, de tú al vendedor, sin adjetivos de marketing. Responde JSON conforme al contrato.';

/**
 * Why each contact is worth it for what the person sells (two or three reasons) and how to open, by a small model with the
 * person's offer and the contact's data only. A reason with a figure the data does not have is left out. Nothing without an
 * offer to connect, or when the model fails: the report keeps the fit, criterion by criterion.
 */
async function adviseOn(items: PendingItem[], userContext: CoworkUserContext | null, generate: Generate) {
  const none = new Map<string, { reasons: string[]; approach: string | null }>();
  const seller = userContext && (userContext.offer || userContext.services?.length) ? {
    company: userContext.companyName, offer: userContext.offer, services: userContext.services, results: userContext.proofPoints,
    differentiators: userContext.differentiators, sector: userContext.sector,
  } : null;
  if (!seller || !items.length) return none;
  const prompt = JSON.stringify({ seller, contacts: items.map(item => ({
    leadId: item.leadId, firstName: item.name.split(' ')[0], title: item.title, level: item.seniority, area: item.department, company: item.company,
    industry: item.industry, employees: item.size, place: placeLabel(item), description: item.description || null,
    fit: (item.fit || []).map(entry => `${entry.criterion}: ${FIT_LABEL[entry.match]}`),
  })) });
  const answer = await generate({
    schema: adviceSchema, maxOutputTokens: 1500, timeoutMs: 25_000, openAiModel: process.env.LEAD_DROPS_RESEARCH_MODEL || 'claude-haiku-5-5', reasoningEffort: 'low',
    systemPrompt: ADVICE_PROMPT, prompt,
  }).catch(() => null);
  // «Reduce su rotación en un 30%»: a figure that is not in the data is the model's, not a fact.
  const known = prompt.replace(/"leadId":"[^"]*"/g, '');
  const grounded = (line: string) => (line.match(/\d+(?:[.,]\d+)*/g) || []).every(figure => known.includes(figure));
  // Without the bullet the model may write; a line too long to read at a glance is left out rather than cut.
  // Nor one that talks about what the data does not say («…, aunque su alcance no está especificado»): that clause is left out.
  const clean = (line: unknown, max: number) => { const value = text(String(line || '').replace(/^[\s\-–•*·]+/, ''), max + 1); return value.length <= max && grounded(value) ? withoutSourceTalk(value) || '' : ''; };
  return new Map(((answer?.contacts || []) as Array<{ leadId: string; reasons: string[]; approach: string | null }>).map(entry => [entry.leadId, {
    reasons: (entry.reasons || []).map(line => clean(line, 280)).filter(Boolean).slice(0, 3),
    approach: clean(entry.approach, 360) || null,
  }]));
}

/** How many emails the Writer writes for a contact: the first and three follow-ups (idea del dueño, 3 Nov 2026). */
export const DROP_SEQUENCE_STEPS = 4;
/** The name the Writer addresses: the first name alone while the search hides the surname («Daniel Ni***o»). */
const addressed = (name: string) => isMaskedName(name) ? name.split(' ')[0] : name;

/**
 * The first email and three follow-ups for one contact, by Cowork's Writer with its checks and its Reviewer, as Cowork writes a
 * sequence: each email with its own role and the day it goes (the first is day 1). When the Writer answers with one email
 * only, that one is the first and there are no follow-ups.
 */
async function draftFor(item: DropItem, userContext: Record<string, unknown> | null, generate: Generate, now: Date, ownSamples: string[] = [],
  /** The writer of the drops (lead-drop-writer.ts): with the seller it writes first; Cowork's Writer below is what is left when it fails. */
  own?: { seller: DropSeller | null; variant: number }) {
  if (own?.seller && dropWriterEnabled()) {
    try {
      const written = await writeDropEmails({ item, seller: own.seller, generate, ownSamples, variant: own.variant });
      return { draft: written.draft, followUps: written.followUps };
    } catch {
      // The model gave nothing usable: the contact still gets its emails, as before 16 Nov 2026.
    }
  }
  const name = addressed(item.name);
  const who = `${name}${item.title ? `, ${item.title}` : ''}${item.company ? ` en ${item.company}` : ''}`;
  // What the research found to open with and why the offer helps this company: the Writer's angle, so the email is about them.
  const angle = [item.brief?.opener ? `Para abrir: ${item.brief.opener}` : null, item.brief?.fit ? `Por qué le sirve: ${item.brief.fit}` : null].filter(Boolean).join(' ').slice(0, 400) || null;
  // Who works in the area but does not decide (DropItem.role): the email asks for the way in, it does not sell to them.
  const refers = item.role === 'refer';
  const brief: CoworkWriteBrief = {
    kind: 'sequence', recipients: [name],
    objective: refers
      ? `Primer correo para ${who}, que trabaja en el área pero no decide la compra: pedirle en corto, con respeto por su tiempo, que te oriente sobre quién ve este tema en su empresa o que te presente. Y tres seguimientos breves si no responde.`
      : `Primer correo de prospección para ${who}, y tres seguimientos si no responde.`,
    angle, tone: null, steps: DROP_SEQUENCE_STEPS,
    notes: refers ? 'No le vendas ni le pidas una reunión comercial: di en una frase qué resuelves y para quién, y pregunta quién es la persona indicada. Los seguimientos insisten en esa misma pregunta, cada vez más breves.' : null,
    findings: null,
  };
  const observations = [{ action: 'leads.recommend', input: '', result: { leads: [{ name, company: item.company || '', title: item.title, industry: item.industry,
    companySize: item.size, city: item.city, companyFacts: item.research } ] } }];
  const models = coworkWriterModels();
  const efforts = coworkWriterEfforts();
  const request = refers ? `Escríbele a ${who} un primer correo para que te diga quién ve este tema en su empresa, y tres seguimientos.`
    : `Escríbele a ${who} un primer correo y tres seguimientos.`;
  const written = await runCoworkWriter({
    request,
    brief, userContext, observations, now,
    generate: async ({ role, schema, systemPrompt, prompt, fix }) => {
      const chosen = coworkWriterCallModel('sequence', role, fix, models, efforts);
      return generate({ schema, systemPrompt, prompt, openAiModel: chosen.model, reasoningEffort: chosen.effort,
        maxOutputTokens: role === 'writer' ? 9000 : 2000, timeoutMs: role === 'writer' ? 70_000 : 25_000 });
    },
    step: async () => {},
  });
  // The voice pass (writer-voice.ts): these emails are read first thing in the morning, next to each other. On the model of the Writer's
  // corrections and through the same call as the rest of the drop.
  const voice = coworkWriterCallModel('sequence', 'writer', true, models, efforts);
  const output = await coworkVoicePass(written, { request, brief, userContext, observations, ownSamples,
    generate: (async (call: { schema: z.ZodTypeAny; systemPrompt?: string; prompt: string }) => ({
      data: await generate({ schema: call.schema, systemPrompt: call.systemPrompt || '', prompt: call.prompt, openAiModel: voice.model, reasoningEffort: voice.effort,
        maxOutputTokens: 1500, timeoutMs: 25_000 }),
      telemetry: { modelName: voice.model || '', usage: null, durationMs: 0 },
    })) as never });
  const blocks = coworkWriterBlocks(output) as Array<{ type: string; subject?: string; body?: string; steps?: Array<{ day?: number; subject?: string; body?: string }> }>;
  const clean = (step: { subject?: string; body?: string } | undefined) => step?.subject && step.body
    ? { subject: text(step.subject, 200), body: String(step.body).trim().slice(0, 4000) } : null;
  const sequence = blocks.find(block => block.type === 'sequence' && Array.isArray(block.steps) && block.steps.length);
  if (sequence?.steps) {
    const [first, ...rest] = sequence.steps;
    const followUps: DropFollowUp[] = rest.slice(0, DROP_SEQUENCE_STEPS - 1).flatMap(step => {
      const email = clean(step);
      return email ? [{ day: Math.max(2, Math.min(60, Math.round(Number(step.day) || 0))), ...email }] : [];
    });
    return { draft: clean(first), followUps };
  }
  return { draft: clean(blocks.find(block => block.type === 'email_draft')), followUps: [] as DropFollowUp[] };
}

/**
 * Completes a pending drop: the short research of each contact (deps.research: what the company does and what is happening there now,
 * from the web), why each contact is worth it for what the person sells (adviseOn) and a first email with three follow-ups for each,
 * written with what the research found. A research, a draft or advice that fails leaves the contact without it.
 */
export async function writeDrop(client: Client, drop: { id: string; organization_id: string; user_id: string; items: PendingItem[] }, deps: {
  generate: Generate; now: Date; parallel?: number;
  /** The research of one contact (researchDropContact with the web); without it, the contacts are written as the search brought them. */
  research?: (input: DropResearchInput) => Promise<DropResearch | null>;
}) {
  const scope = { organizationId: drop.organization_id, userId: drop.user_id };
  const [userContext, about, ownSamples] = await Promise.all([
    loadCoworkUserContext(client, scope, { memories: true, mailbox: false }),
    summarizeCompanies(drop.items, deps.generate),
    // «Tu voz»: the emails the person chose as samples of how they write, else their organization's voice examples.
    voiceSamplesFor({ ...scope, client }).catch(() => [] as string[]),
  ]);
  const seller = await dropSellerOf(client, scope, userContext).catch(() => null);
  // Every contact is researched at once: two searches, a page and a small model each, before anything is written about them.
  const found = new Map<string, DropResearch>();
  if (deps.research) {
    const seller = userContext ? { company: userContext.companyName, offer: userContext.offer, services: userContext.services, proofPoints: userContext.proofPoints, sector: userContext.sector } : null;
    await Promise.all(drop.items.map(async item => {
      const result = await deps.research!({ organizationId: scope.organizationId, seller,
        contact: { title: item.title, company: item.company, domain: item.domain, country: item.country, industry: item.industry } }).catch(() => null);
      if (result) found.set(item.leadId, result);
    }));
  }
  // The description stays out of the saved drop: what reaches the person is its summary.
  const items: DropItem[] = drop.items.map(({ description: _description, ...item }) => {
    const research = found.get(item.leadId);
    const summary = research?.brief.company ?? about.get(item.leadId) ?? null;
    const facts = [summary, research?.brief.news ? briefNewsLine(research.brief.news) : null, ...item.research].filter((fact): fact is string => Boolean(fact));
    return {
      ...item, summary, research: facts.filter((fact, index) => facts.indexOf(fact) === index).slice(0, 3),
      ...(research ? { brief: research.brief } : {}),
      // The site the research told from the company's name, when the search brought none.
      ...(research?.domain && !item.domain ? { domain: research.domain, website: item.website ?? `https://${research.domain}` } : {}),
    };
  });
  // The advice reads what the research found of each company, as it read the search's description.
  const advised = drop.items.map(item => {
    const brief = found.get(item.leadId)?.brief;
    const known = [brief?.company, brief?.news ? briefNewsLine(brief.news) : null].filter(Boolean).join(' ');
    return known && !item.description ? { ...item, description: known } : item;
  });
  const parallel = Math.max(1, deps.parallel ?? 3);
  const [advice] = await Promise.all([adviseOn(advised, userContext, deps.generate), (async () => {
    for (let start = 0; start < items.length; start += parallel) {
      await Promise.all(items.slice(start, start + parallel).map(async item => {
        const written = await draftFor(item, userContext as Record<string, unknown> | null, deps.generate, deps.now, ownSamples,
          { seller, variant: items.indexOf(item) }).catch(() => null);
        item.draft = written?.draft ?? null;
        if (written?.followUps.length) item.followUps = written.followUps;
      }));
    }
  })()]);
  for (const item of items) {
    const found = advice.get(item.leadId);
    if (found) Object.assign(item, found);
  }
  const saved = await client.from('lead_drops').update({ status: 'ready', items, updated_at: new Date().toISOString() }).eq('id', drop.id).eq('status', 'pending');
  if (saved.error) throw new LeadDropsError('No pudimos guardar tu contacto del día.', 503);
  return { written: items.filter(item => item.draft).length, items };
}

// ─── Reading, saving and the PDF ───────────────────────────────────────────────────────────────────────────────────

/** A drop of the person, in the selected organization; never another person's. */
export async function readDrop(client: Client, scope: DropScope, dropId: string) {
  const result: any = await client.from('lead_drops').select('id,drop_date,status,criteria,items,opened_at,saved_at,created_at')
    .eq('id', dropId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (result.error) throw new LeadDropsError('No pudimos leer tu contacto del día.', 503);
  if (!result.data || !['ready', 'sent'].includes(result.data.status)) throw new LeadDropsError('No encontramos esos contactos.', 404);
  return result.data as { id: string; drop_date: string; status: string; criteria: DropCriteria; items: DropItem[]; opened_at: string | null; saved_at: string | null };
}

/**
 * Whose a drop is, whatever workspace is open: asked only after `readDrop` did not find it for the signed-in person, to tell «it is
 * yours, in another of your workspaces» (the app moves there) from «it is another account's» (said as such). Null when there is none.
 */
export async function dropOwner(client: Client, dropId: string) {
  const result: any = await client.from('lead_drops').select('organization_id,user_id,status').eq('id', dropId).maybeSingle();
  if (result.error) throw new LeadDropsError('No pudimos leer tu contacto del día.', 503);
  if (!result.data || !['ready', 'sent'].includes(result.data.status)) return null;
  return { organizationId: String(result.data.organization_id), userId: String(result.data.user_id) };
}

/** The person's latest drop of the last week with something left to save, for «Hoy», with the next one to save. */
type LatestRow = { id: string; drop_date: string; items: DropItem[] } | null;
/** The person's last drop of the week that has contacts. */
async function latestDropRow(client: Client, scope: DropScope, now: Date): Promise<LatestRow> {
  const since = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const result: any = await client.from('lead_drops').select('id,drop_date,status,items').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .in('status', ['ready', 'sent']).gte('drop_date', since).order('drop_date', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new LeadDropsError('No pudimos leer tu contacto del día.', 503);
  return result.data ? { id: String(result.data.id), drop_date: String(result.data.drop_date), items: (result.data.items || []) as DropItem[] } : null;
}
function dropSummary(row: LatestRow) {
  const items = row?.items || [];
  const unsaved = items.filter(item => !item.savedLeadId);
  if (!row || !unsaved.length) return null;
  const { company, why } = unsaved[0];
  const name = dropName(unsaved[0]);
  // «Hoy» says what saving it costs: nothing when the email came with the search, a credit when it is looked up (Apollo). Of a drop
  // of several, it says so for all that are left, and whether each comes with its campaign written.
  return { id: row.id, dropDate: row.drop_date, total: items.length, left: unsaved.length,
    next: { name, company, why, ...(needsLookup(unsaved[0]) ? { lookup: true } : {}) },
    ...(items.length > 1 && unsaved.some(needsLookup) ? { lookup: true } : {}), ...(items.length > 1 && unsaved.some(item => item.draft) ? { campaigns: true } : {}) };
}
export async function latestDrop(client: Client, scope: DropScope, now: Date) {
  return dropSummary(await latestDropRow(client, scope, now));
}

/** A contact of a drop of several still asks something of the person: its email to look up, or its campaign to approve. */
export const dropItemPending = (item: DropItem) => !item.savedLeadId || Boolean(item.draft && !item.campaign);
/**
 * The contacts «Hoy» shows in full, to work on right there (13 Nov 2026, the owner: «que sea una sección especial dentro del sistema,
 * en Hoy»): a drop of several contacts (a team's plan), all day on its day, and on the days after while a contact of it still waits
 * for its email or its approval. A drop of one contact keeps its line in «Hoy» (`dropSummary`).
 */
/**
 * The person's last contacts of the week, for «Tus contactos de hoy» under «Hoy» in the menu (16 Nov 2026): which drop it opens and
 * how many of its contacts still wait for the person. Null without one: the menu does not list the screen.
 */
export async function latestDropPending(client: Client, scope: DropScope, now: Date) {
  const row = await latestDropRow(client, scope, now);
  return row && row.items.length ? { id: row.id, date: row.drop_date, left: row.items.filter(dropItemPending).length } : null;
}
function dropBoard(row: LatestRow, now: Date) {
  if (!row || row.items.length < 2) return null;
  if (row.drop_date !== dayInZone(now) && !row.items.some(dropItemPending)) return null;
  return { id: row.id, date: row.drop_date, items: row.items };
}

/**
 * What «Hoy» offers when the person has no drop left to save, whether or not drops reach them by email: today's, made at
 * that moment, on drop days («today»), any day while they never got one («first»); back to it while it is
 * written («preparing»); or, without a customer to go by, to tell it in «Perfil» («profile»). Nothing when drops are off,
 * today's is done, or the month's budget would not pay a search.
 */
export type PullOffer = 'first' | 'today' | 'preparing' | 'profile' | null;
export async function pullStatus(client: Client, scope: DropScope, now: Date): Promise<PullOffer> {
  if (!dropsEnabled()) return null;
  const result: any = await client.from('lead_drops').select('drop_date,status,criteria').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('drop_date', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new LeadDropsError('No pudimos leer tu contacto del día.', 503);
  const last = result.data as { drop_date: string; status: string; criteria: unknown } | null;
  const today = Boolean(last) && String(last!.drop_date) === dayInZone(now);
  if (today && last!.status === 'pending') return 'preparing';
  // Nothing to offer to whoever gets no contacts (their team gives them by person, and they have no plan of their own).
  const plan = await dropPlanFor(client, scope.organizationId, scope.userId);
  if (!plan.size) return null;
  const fresh = !last || withoutCustomer(last);
  if (!fresh && (today || !dropDay(now, plan))) return null;
  if (!customerFor(await teamOf(client, scope.organizationId), scope.userId)) return 'profile';
  const usdPerLead = dropUsdPerLead();
  if (usdPerLead > 0 && overBudget(await monthSpend(client, now), searchCount(1), usdPerLead, dropsMonthlyUsd())) return null;
  return fresh ? 'first' : 'today';
}

/**
 * What «Hoy» shows: the last drop with a contact left to save; on drop days, today's comes first (offered, or on its
 * way), so one nobody saved does not hold back the new one.
 */
export async function homeDrop(client: Client, scope: DropScope, now: Date): Promise<{ drop: ReturnType<typeof dropSummary>; pull: PullOffer; plan?: { size: number; days: number };
  board?: { id: string; date: string; items: DropItem[] } }> {
  const row = await latestDropRow(client, scope, now);
  // Several contacts are «Hoy»'s own section, with each contact in full: no line about them besides, and nothing else to offer.
  const board = dropBoard(row, now);
  if (board?.date === dayInZone(now)) return { drop: null, pull: null, board };
  const drop = board ? null : dropSummary(row);
  if (drop?.dropDate === dayInZone(now)) return { drop, pull: null };
  // An earlier one, with something left: it stays until a new one is due, which never waits for it.
  const pull = await pullStatus(client, scope, now);
  if (board && pull !== 'today' && pull !== 'preparing') return { drop: null, pull: null, board };
  if (drop && pull !== 'today' && pull !== 'preparing') return { drop, pull: null };
  if (!pull) return { drop: null, pull };
  // A team (or a person) with a plan of its own is offered what it gets: how many contacts, and on how many days of the week.
  const plan = await dropPlanFor(client, scope.organizationId, scope.userId);
  return { drop: null, pull, ...(plan.size > 1 ? { plan: { size: plan.size, days: plan.weekdays.length } } : {}) };
}

/** Why a drop came empty, said to the person, and the button to «Perfil» when completing the customer helps. */
export function emptyReason(error: string | null, now: Date, plan: DropPlan = DEFAULT_DROP_PLAN): { title: string; text: string; profile: string | null } {
  if (error === NO_CUSTOMER) return { title: 'Falta tu cliente ideal', text: 'Con él elegimos tu contacto: a quién le vendes, en qué rubro y dónde. Toma un minuto en «Perfil».', profile: 'Completar mi cliente ideal' };
  if (error === NO_BUDGET) return { title: 'Por este mes no quedan contactos', text: 'Este mes ya se usaron todos los contactos del día: vuelven el próximo mes. Mientras, puedes buscar con tus filtros.', profile: null };
  if (error === TOO_FEW) return { title: 'Esta vez no hubo un contacto nuevo', text: 'Tu equipo ya tiene a muchos de los que calzan con tu cliente ideal. Sumar cargos, rubros o lugares trae contactos nuevos.', profile: 'Ampliar mi cliente ideal' };
  if (error === NOBODY) return { title: 'Esta vez no encontramos a nadie', text: 'Con tu cliente ideal no encontramos personas con correo. Sumar cargos o lugares en «Perfil» ayuda.', profile: 'Ampliar mi cliente ideal' };
  return { title: 'La búsqueda no respondió', text: `Esta vez no pudimos traer tu contacto. El próximo llega ${nextDropDay(now, plan)}; mientras, puedes buscar con tus filtros.`, profile: null };
}

/** A pending drop nobody finished writing in this time (the request that planned it died) is written by the next one. */
const STALLED_MS = 4 * 60_000;

/**
 * Today's drop of one person, made now when «Hoy» offers it (pullStatus): one search and the first email, a minute or
 * two, as the morning run makes it. Today's row is taken before searching, so a second request (another tab, or back
 * from «Hoy») answers «pending» instead of searching again: ask again. An «empty» one says why (emptyReason); without a
 * customer nothing is searched nor kept, so it is made once there is one.
 */
export async function pullDrop(client: Client, scope: DropScope, deps: { now: Date; generate: Generate; search?: Search;
  research?: (input: DropResearchInput) => Promise<DropResearch | null> }) {
  const today = dayInZone(deps.now);
  const teamPlan = await dropPlanFor(client, scope.organizationId, scope.userId);
  const read = async () => {
    const result: any = await client.from('lead_drops').select('id,organization_id,user_id,status,criteria,items,error,created_at,updated_at')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('drop_date', today).maybeSingle();
    if (result.error) throw new LeadDropsError('No pudimos leer tu contacto del día.', 503);
    return result.data as { id: string; organization_id: string; user_id: string; status: string; criteria: unknown; items: PendingItem[]; error: string | null;
      created_at: string; updated_at: string } | null;
  };
  const stalled = (row: { created_at: string; updated_at: string }) => deps.now.getTime() - Date.parse(row.updated_at || row.created_at) > STALLED_MS;
  const plan = async () => {
    await planOrganizationDrops(client, scope.organizationId, [scope.userId], {
      now: deps.now, search: deps.search, budgetUsd: dropsMonthlyUsd(), spentUsd: await monthSpend(client, deps.now), claimed: true, plan: teamPlan,
      generate: deps.generate, quick: true,
    });
    const row = await read();
    if (!row) throw new LeadDropsError('No pudimos preparar tu contacto del día.', 503);
    return row;
  };
  const waiting = (id: string | null) => ({ id, status: 'pending', reason: null });

  let drop = await read();
  let planned = false;
  if (!drop || withoutCustomer(drop)) {
    const offer = await pullStatus(client, scope, deps.now);
    if (offer === 'profile') return { id: null, status: 'empty', reason: emptyReason(NO_CUSTOMER, deps.now, teamPlan) };
    if (offer !== 'first' && offer !== 'today') {
      const usdPerLead = dropUsdPerLead();
      const broke = dropsEnabled() && usdPerLead > 0 && overBudget(await monthSpend(client, deps.now), searchCount(1), usdPerLead, dropsMonthlyUsd());
      throw new LeadDropsError(!dropsEnabled() ? 'El contacto del día está en pausa.'
        : broke ? 'Este mes ya se usaron todos los contactos del día: vuelven el próximo mes.'
          : teamPlan === NO_DROP_PLAN || !teamPlan.size ? 'Tu equipo no tiene contactos del día activos para ti.' : `Tu próximo contacto llega ${nextDropDay(deps.now, teamPlan)}.`, 409);
    }
    if (drop) {
      const removed = await client.from('lead_drops').delete().eq('id', drop.id).eq('status', 'empty');
      if (removed.error) throw new LeadDropsError('No pudimos preparar tu contacto del día.', 503);
    }
    const claim = await client.from('lead_drops').insert({ organization_id: scope.organizationId, user_id: scope.userId, drop_date: today, status: 'pending',
      criteria: {}, items: [], cost_usd: 0, updated_at: deps.now.toISOString() });
    if (claim.error?.code === '23505') return waiting((await read())?.id ?? null);
    if (claim.error) throw new LeadDropsError('No pudimos preparar tu contacto del día.', 503);
    drop = await plan();
    planned = true;
  } else if (drop.status === 'pending' && !drop.items.length && stalled(drop)) {
    // The request that was searching died: whoever takes the row back searches again.
    const taken: any = await client.from('lead_drops').update({ updated_at: deps.now.toISOString() }).eq('id', drop.id).eq('updated_at', drop.updated_at).select('id');
    if (taken.error) throw new LeadDropsError('No pudimos preparar tu contacto del día.', 503);
    if (!taken.data?.length) return waiting(drop.id);
    drop = await plan();
    planned = true;
  }
  if (drop.status === 'pending' && drop.items.length && (planned || stalled(drop))) {
    await writeDrop(client, drop, { generate: deps.generate, now: deps.now, research: deps.research, parallel: Math.max(3, Math.min(6, drop.items.length)) });
    drop = (await read()) || drop;
  }
  return { id: drop.id, status: drop.status, reason: drop.status === 'empty' ? emptyReason(drop.error, deps.now, teamPlan) : null };
}

/**
 * Saves contacts of a drop in «Por escribir», with their email (and phone, when the search brought one) out of the vault:
 * no credits and no other search. Someone already in «Por escribir» with the same email is linked, not duplicated. The
 * research and the first email go with the contact (`data.leadDrop`).
 */
export async function saveDropLeads(client: Client, scope: DropScope, dropId: string, leadIds?: string[], options: { now?: Date } = {}) {
  const drop = await readDrop(client, scope, dropId);
  // Apollo's contacts have no email in the vault: they are saved with «Enriquecer y guardar» (keepDropLead, then linkDropLead).
  const wanted = drop.items.filter(item => !item.savedLeadId && item.provider !== 'apollo' && (!leadIds || leadIds.includes(item.leadId)));
  if (!wanted.length) return { saved: [], expired: [], items: drop.items };
  // The vault forgets a contact after LEADS_FINDER_VAULT_DAYS: the hour that decides whether it is still there is the one the caller gives.
  const clock = options.now ?? new Date();
  const vault = await readFromVault(client, { organizationId: scope.organizationId, ids: wanted.map(item => item.leadId), now: clock.getTime() });
  const now = clock.toISOString();
  const saved: Array<{ leadId: string; savedLeadId: string }> = [];
  const expired: string[] = [];
  for (const item of wanted) {
    const entry = vault.get(item.leadId);
    if (!entry) { expired.push(item.leadId); continue; }
    const email = String(entry.contact.email || '').trim().toLowerCase();
    const existing: any = email ? await client.from('enriched_leads').select('id').eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('email', email).limit(1).maybeSingle() : { data: null };
    if (existing.data?.id) { saved.push({ leadId: item.leadId, savedLeadId: String(existing.data.id) }); continue; }
    const row = enrichedLeadRow(entry, { id: randomUUID(), userId: scope.userId, organizationId: scope.organizationId, revealEmail: true, revealPhone: true, now });
    const leadDrop = leadDropData(dropId, item);
    const inserted: any = await client.from('enriched_leads').insert({ ...row, data: { ...row.data, leadDrop } })
      .select('id').maybeSingle();
    if (inserted.error || !inserted.data) continue;
    saved.push({ leadId: item.leadId, savedLeadId: String(inserted.data.id) });
  }
  const savedIds = new Map(saved.map(entry => [entry.leadId, entry.savedLeadId]));
  const items = drop.items.map(item => savedIds.has(item.leadId) ? { ...item, savedLeadId: savedIds.get(item.leadId)! } : item);
  await client.from('lead_drops').update({ items, saved_at: now, updated_at: now }).eq('id', dropId);
  await forgetInVault(client, { organizationId: scope.organizationId, ids: saved.map(entry => entry.leadId) });
  return { saved, expired, items };
}

/** What a saved contact keeps of its drop (`data.leadDrop`): why we recommended it, the research, the first email and its follow-ups. */
const leadDropData = (dropId: string, item: DropItem) => ({ dropId, why: item.why, research: item.research, draft: item.draft,
  ...(item.followUps?.length ? { followUps: item.followUps } : {}), ...(item.reasons?.length ? { reasons: item.reasons, approach: item.approach ?? null } : {}) });

/** An Apollo contact of the person's drop, or why not. */
async function apolloItem(client: Client, scope: DropScope, dropId: string, leadId: string) {
  const drop = await readDrop(client, scope, dropId);
  const item = drop.items.find(entry => entry.leadId === leadId);
  if (!item || item.provider !== 'apollo') throw new LeadDropsError('No encontramos ese contacto en tu contacto del día.', 404);
  return { drop, item };
}

/**
 * «Enriquecer y guardar», first half: an Apollo contact of the drop becomes one of the person's saved contacts, as Cowork saves a
 * search result (insertCoworkContact: insert only, and refused when another member holds that person), so its email is looked
 * up the way every saved contact is completed (completeSavedContacts, 1 credit, with its quota and the organization's share).
 * The browser does that lookup and then calls linkDropLead. Saving it again returns the same saved contact.
 */
export async function keepDropLead(auth: Pick<AuthContext, 'supabase' | 'user' | 'organizationId'>, client: Client, dropId: string, leadId: string, now = new Date()) {
  const scope = { organizationId: auth.organizationId, userId: String(auth.user.id) };
  const { drop, item } = await apolloItem(client, scope, dropId, leadId);
  if (item.savedLeadId) return { keptLeadId: item.keptLeadId ?? null, savedLeadId: item.savedLeadId, items: drop.items };
  let kept: Awaited<ReturnType<typeof insertCoworkContact>>;
  try {
    kept = await insertCoworkContact({ ...auth, organizationIds: [auth.organizationId] } as AuthContext, `apollo:${leadId}`, {
      name: item.name, company: item.company, title: item.title, industry: item.industry, location: placeLabel(item) || null,
      company_website: item.website || (item.domain ? `https://${item.domain}` : null), company_linkedin: item.companyLinkedin || null,
    });
  } catch (error) {
    // Another member holds them (lead-claim.ts): said as the database says it.
    if (error instanceof Error && error.name === 'LeadClaimedError') throw new LeadDropsError(error.message, 409);
    throw new LeadDropsError('No pudimos guardar este contacto. Inténtalo de nuevo.', 503);
  }
  const keptLeadId = String(kept.lead.id);
  const items = drop.items.map(entry => entry.leadId === leadId ? { ...entry, keptLeadId } : entry);
  const written = await client.from('lead_drops').update({ items, updated_at: now.toISOString() }).eq('id', dropId);
  if (written.error) throw new LeadDropsError('No pudimos guardar este contacto. Inténtalo de nuevo.', 503);
  return { keptLeadId, savedLeadId: null, items };
}

/**
 * «Enriquecer y guardar», second half, after the lookup: the contact in «Por escribir» that Apollo's person became gets the drop's
 * reasons, first email and follow-ups (`data.leadDrop`), and the drop shows it saved. Without one (no email found) nothing changes.
 */
export async function linkDropLead(client: Client, scope: DropScope, dropId: string, leadId: string, now = new Date()) {
  const { drop, item } = await apolloItem(client, scope, dropId, leadId);
  if (item.savedLeadId) return { linked: true, savedLeadId: item.savedLeadId, items: drop.items };
  const found: any = await client.from('enriched_leads').select('id,data,full_name').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .eq('source_provider_id', leadId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (found.error) throw new LeadDropsError('No pudimos revisar el contacto.', 503);
  if (!found.data) return { linked: false, savedLeadId: null, items: drop.items };
  const savedLeadId = String(found.data.id);
  const data = found.data.data && typeof found.data.data === 'object' ? found.data.data : {};
  await client.from('enriched_leads').update({ data: { ...data, leadDrop: leadDropData(dropId, item) } }).eq('id', savedLeadId)
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  // The lookup brings the surname the search hid: the drop shows it from now on.
  const fullName = typeof found.data.full_name === 'string' && found.data.full_name.trim() && !isMaskedName(found.data.full_name) ? found.data.full_name.trim() : null;
  const items = drop.items.map(entry => entry.leadId === leadId ? { ...entry, savedLeadId, ...(fullName ? { name: fullName } : {}) } : entry);
  const stamp = now.toISOString();
  const written = await client.from('lead_drops').update({ items, saved_at: stamp, updated_at: stamp }).eq('id', dropId);
  if (written.error) throw new LeadDropsError('No pudimos guardar este contacto. Inténtalo de nuevo.', 503);
  return { linked: true, savedLeadId, items };
}

/** «28 de octubre de 2026»: the drop's day as the PDF says it. */
export function dropDateLabel(day: string) {
  const date = new Date(`${day}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** A body with its own line breaks, without the spaces and the empty lines a model leaves. */
const tidyBody = (body: string) => body.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
/** «Ripley S.A.» without its legal form, as a heading says it. */
const shortCompany = (name: string) => name.replace(/,?\s+(S\.A\.|SpA|Ltda\.|EIRL)$/, '');
const labelled = (label: string, value: Run[] | string | null | undefined) =>
  value && (typeof value === 'string' ? value.trim() : value.length) ? { runs: [{ text: `${label}: `, bold: true }, ...(typeof value === 'string' ? [{ text: value }] : value)] } : null;
const present = <T,>(values: Array<T | null>) => values.filter((value): value is T => value !== null);
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/**
 * One contact in the document: why we recommend them (what matched, and why it is worth it for what the person sells), how
 * they fit the customer criterion by criterion, who they are, their company, how to open, and the first email in its own
 * box, then its follow-ups (since 3 Nov 2026). A drop from before 29 Oct 2026, without those parts, shows what it has: the
 * why, the research and the email.
 */
function dropItemBlocks(item: DropItem): DocBlock[] {
  const blocks: DocBlock[] = [];
  const reasons = item.reasons?.length ? `\n\n${item.reasons.map(reason => `- ${reason}`).join('\n')}` : '';
  blocks.push({ type: 'callout', tone: 'info', title: 'Por qué te lo recomendamos', runs: [{ text: item.why, bold: Boolean(reasons) }, ...(reasons ? [{ text: reasons }] : [])] });
  if (item.fit?.length) {
    blocks.push({ type: 'heading', level: 2, runs: [{ text: 'Cómo calza con tu cliente ideal' }] });
    blocks.push({ type: 'table', columns: [{ header: [{ text: 'Criterio' }] }, { header: [{ text: 'Este contacto' }] }, { header: [{ text: 'Lo que buscas' }] }, { header: [{ text: '¿Calza?' }] }],
      rows: item.fit.map(entry => [[{ text: entry.criterion, bold: true }], [{ text: entry.theirs }], [{ text: entry.wanted }], [{ text: FIT_LABEL[entry.match], bold: entry.match === 'yes' }]]) });
  }
  if (item.fit) {
    // What the table and the title do not say already: the role is under the name, the place and the industry in the table.
    const shown = new Set(item.fit.map(entry => entry.criterion));
    const person = present([
      labelled('Nivel', item.seniority), labelled('Área', item.department), shown.has('Lugar') ? null : labelled('Ubicación', placeLabel(item)),
      labelled('Datos de contacto', item.provider === 'apollo' ? 'tiene correo, que ves al enriquecerlo y guardarlo (1 crédito)'
        : `${item.hasPhone ? 'correo verificado y teléfono móvil' : 'correo verificado'}, que ves al guardarlo`),
    ]);
    blocks.push({ type: 'heading', level: 2, runs: [{ text: 'Sobre la persona' }] });
    blocks.push({ type: 'list', ordered: false, items: person });
    // «Construcción · 70 personas · topwood.cl · LinkedIn de la empresa», in one line under what the company does.
    const facts: Run[][] = [shown.has('Rubro') ? null : item.industry, shown.has('Tamaño') || !item.size ? null : `${item.size.toLocaleString('es-CL')} personas`]
      .filter((value): value is string => Boolean(value)).map(value => [{ text: value }]);
    if (item.website) facts.push([{ text: hostOf(item.website), href: item.website }]);
    if (item.companyLinkedin) facts.push([{ text: 'LinkedIn de la empresa', href: item.companyLinkedin }]);
    if (item.summary || facts.length) {
      blocks.push({ type: 'heading', level: 2, runs: [{ text: item.company ? `Sobre ${shortCompany(item.company)}` : 'Sobre la empresa' }] });
      if (item.summary) blocks.push({ type: 'paragraph', runs: [{ text: item.summary }] });
      if (facts.length) blocks.push({ type: 'paragraph', runs: facts.flatMap((runs, index) => index ? [{ text: '  ·  ' }, ...runs] : runs) });
    }
  } else if (item.research.length) {
    blocks.push({ type: 'heading', level: 2, runs: [{ text: 'Lo que sabemos de la empresa' }] });
    blocks.push({ type: 'list', ordered: false, items: item.research.map(fact => ({ runs: [{ text: fact }] })) });
  }
  if (item.approach) {
    blocks.push({ type: 'heading', level: 2, runs: [{ text: 'Cómo abordarlo' }] });
    blocks.push({ type: 'paragraph', runs: [{ text: item.approach }] });
  }
  if (item.draft) {
    blocks.push({ type: 'heading', level: 2, runs: [{ text: 'Primer correo sugerido' }] });
    // The subject as its first line, in its own case (a callout title would be in capitals), and the body with its own line breaks.
    blocks.push({ type: 'callout', tone: 'neutral', runs: [
      { text: 'Asunto: ', bold: true }, { text: item.draft.subject, bold: true },
      { text: `\n\n${tidyBody(item.draft.body)}` },
    ] });
  }
  if (item.followUps?.length) {
    blocks.push({ type: 'heading', level: 2, runs: [{ text: `Si no responde: ${item.followUps.length === 1 ? 'un seguimiento' : `${item.followUps.length} seguimientos`}` }] });
    for (const step of item.followUps) {
      blocks.push({ type: 'callout', tone: 'neutral', runs: [
        { text: `Día ${step.day} · `, bold: true }, { text: 'Asunto: ', bold: true }, { text: step.subject, bold: true }, { text: `\n\n${tidyBody(step.body)}` },
      ] });
    }
  }
  return blocks;
}

/**
 * «Contacto del día» as a document (src/lib/documents): each contact with why we recommend them, how they fit, who they are,
 * their company, how to open and the first email, and the way to save them as a button-like link instead of a bare address.
 */
export function dropDocument(items: DropItem[], meta: { name: string; date: string; link: string }): DocumentSpec {
  const one = items.length === 1;
  const role = (item: DropItem) => [item.title, item.company].filter(Boolean).join(' · ');
  const blocks: DocBlock[] = [{ type: 'paragraph', runs: [
    { text: one ? 'Ver y guardar en ANTON.IA' : `Ver y guardar los ${items.length} en ANTON.IA`, href: meta.link, bold: true },
    { text: items.some(item => item.provider === 'apollo') ? `   ${dropCostNote(items)}`
      : one ? '   Su correo ya está listo. Guardarlo no gasta créditos.' : '   Sus correos ya están listos. Guardarlos no gasta créditos.' },
  ] }];
  items.forEach((item, index) => {
    if (!one) {
      if (index) blocks.push({ type: 'pageBreak' });
      blocks.push({ type: 'heading', level: 1, runs: [{ text: dropName(item) }] });
      if (role(item)) blocks.push({ type: 'paragraph', runs: [{ text: role(item) }] });
    }
    blocks.push(...dropItemBlocks(item));
  });
  return {
    title: one ? dropName(items[0]) : `${items.length} contactos para hoy`,
    subtitle: one ? role(items[0]) || undefined : undefined,
    meta: [...(meta.name ? [{ label: 'Para', value: meta.name }] : []), { label: 'Fecha', value: dropDateLabel(meta.date) }],
    runningTitle: `Contacto del día · ${dropDateLabel(meta.date)}`,
    theme: 'antonia',
    blocks,
  };
}

/** «Contacto del día» as a PDF, laid out by the document engine every ANTON.IA document uses. */
export async function dropPdf(items: DropItem[], meta: { name: string; date: string; link: string }) {
  const { bytes } = await renderPdf(dropDocument(items, meta));
  return Buffer.from(bytes);
}
