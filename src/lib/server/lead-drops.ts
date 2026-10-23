import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { dayInZone } from '@/lib/admin/chile-time';
import { industryLabel } from '@/lib/companies/coverage';
import { coworkWriterBlocks, runCoworkWriter, type CoworkWriteBrief } from '@/lib/cowork/writer';
import {
  DROP_SIZE, assignDrops, criteriaKey, dropCriteria, dropDay, nextDropDay, researchFacts, tidyCompany, tidyTitle, whyText,
  type DropCandidate, type DropCriteria, type DropItem, type IcpDeclared, type KnownPeople,
} from '@/lib/lead-drops';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import type { LeadSearchInput } from '@/lib/server/apollo-provider/validation';
import { loadCoworkUserContext } from '@/lib/server/cowork/user-context';
import { coworkWriterCallModel, coworkWriterEfforts, coworkWriterModels } from '@/lib/server/cowork/writer-run';
import { leadsFinderMaxRunUsd, leadsFinderUsdPerLead, searchLeadsFinder } from '@/lib/server/leads-finder/client';
import { leadsFinderIndustry } from '@/lib/server/leads-finder/input';
import { enrichedLeadRow } from '@/lib/server/leads-finder/reveal';
import { forgetInVault, readFromVault, storeInVault, type VaultEntry } from '@/lib/server/leads-finder/vault';

/** The reads, the preparation and the save of «Contacto del día» (src/lib/lead-drops.ts). Server only. */
type Client = SupabaseClient;
export type DropScope = { organizationId: string; userId: string };
type Search = typeof searchLeadsFinder;
type Generate = (options: { schema: z.ZodTypeAny; systemPrompt: string; prompt: string; openAiModel?: string; reasoningEffort?: any;
  maxOutputTokens: number; timeoutMs: number }) => Promise<any>;

export class LeadDropsError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const DAY = 86_400_000;
const text = (value: unknown, max = 300) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
/** LEAD_DROPS_MONTHLY_USD: what Apify may spend on drops in a month, across organizations (the plan is shared). */
export const dropsMonthlyUsd = (env: Record<string, string | undefined> = process.env) => {
  const value = Number(env.LEAD_DROPS_MONTHLY_USD);
  return Number.isFinite(value) && value >= 0 ? value : 3;
};
export const dropsEnabled = (env: Record<string, string | undefined> = process.env) => env.LEAD_DROPS_ENABLED !== 'off';

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
async function knownPeople(client: Client, organizationId: string, now: Date): Promise<KnownPeople> {
  const since = new Date(now.getTime() - 180 * DAY).toISOString().slice(0, 10);
  const [enriched, contacted, drops]: any[] = await Promise.all([
    client.from('enriched_leads').select('email,linkedin_url,source_provider_id').eq('organization_id', organizationId).limit(10000),
    client.from('contacted_leads').select('email').eq('organization_id', organizationId).limit(10000),
    client.from('lead_drops').select('items').eq('organization_id', organizationId).gte('drop_date', since).limit(2000),
  ]);
  if (enriched.error || contacted.error || drops.error) throw new LeadDropsError('No pudimos leer los contactos del equipo.', 503);
  const lower = (value: unknown) => String(value || '').trim().toLowerCase();
  return {
    emails: new Set([...(enriched.data || []), ...(contacted.data || [])].map((row: any) => lower(row.email)).filter(Boolean)),
    linkedins: new Set((enriched.data || []).map((row: any) => lower(row.linkedin_url).replace(/\/$/, '')).filter(Boolean)),
    leadIds: new Set([
      ...(enriched.data || []).map((row: any) => String(row.source_provider_id || '')),
      ...(drops.data || []).flatMap((row: any) => (Array.isArray(row.items) ? row.items : []).map((item: any) => String(item?.leadId || ''))),
    ].filter(Boolean)),
  };
}

/**
 * A Leads Finder result as a candidate: what the screen may show, and the email and LinkedIn only as keys to skip known
 * people. The title with its linking words in lower case, the company with its legal form («S.A.») and the industry in
 * Spanish («logistics & supply chain» → «Logística»), as the screen, the email and the PDF say them.
 */
function candidateOf(entry: VaultEntry): DropCandidate {
  const { lead, contact } = entry;
  return {
    leadId: lead.id, name: text(contact.fullName, 200) || text(lead.name, 200), title: tidyTitle(text(lead.title, 160)),
    company: tidyCompany(text(lead.organization_name, 200)), domain: text(lead.organization_domain, 253) || null,
    industry: industryLabel(text(lead.organization_industry, 160)), size: typeof lead.organization_size === 'number' ? lead.organization_size : null,
    city: text(lead.city, 160) || null, hasEmail: Boolean(contact.email), hasPhone: Boolean(contact.mobileNumber),
    emailKey: contact.email ? contact.email.toLowerCase() : null, linkedinKey: contact.linkedinUrl ? contact.linkedinUrl.toLowerCase().replace(/\/$/, '') : null,
    about: text(lead.organization?.short_description, 600) || null,
  };
}

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

/** What a customer is chosen from: the team, admins first (their customer speaks for the team when a person has none), and what it saved. */
async function teamOf(client: Client, organizationId: string) {
  const [members, saved]: any[] = await Promise.all([
    client.from('organization_members').select('user_id,role').eq('organization_id', organizationId),
    client.from('enriched_leads').select('title,organization_industry').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(1000),
  ]);
  if (members.error || saved.error) throw new LeadDropsError('No pudimos leer el equipo.', 503);
  const memberIds = (members.data || []).map((row: any) => String(row.user_id));
  const profiles: any = memberIds.length ? await client.from('profiles').select('id,full_name,company_name,company_domain,job_title,signatures').in('id', memberIds) : { data: [] };
  if (profiles.error) throw new LeadDropsError('No pudimos leer los perfiles.', 503);
  const byId = new Map<string, any>(((profiles.data || []) as any[]).map(row => [String(row.id), row]));
  const rank = (id: string) => ['owner', 'admin'].includes(String((members.data || []).find((row: any) => String(row.user_id) === id)?.role)) ? 0 : 1;
  const team: string[] = memberIds.slice().sort((a: string, b: string) => rank(a) - rank(b));
  const savedRows = ((saved.data || []) as any[]).map(row => ({ title: row.title, industry: row.organization_industry }));
  return { byId, team, savedRows };
}
type Team = Awaited<ReturnType<typeof teamOf>>;
const customerOf = (userId: string, { byId, team, savedRows }: Team) =>
  dropCriteria(declaredOf(byId.get(userId)), team.filter(id => id !== userId).map(id => declaredOf(byId.get(id))), savedRows);
/** How many a search asks for: twice what the group needs and some more (some are known already, some have no email), ten at least. */
const searchCount = (people: number) => Math.max(10, Math.min(100, people * DROP_SIZE * 2 + 5));

/** Why a drop came empty, as it is kept; `emptyReason` says it to the person. */
const NO_CUSTOMER = 'Sin cliente ideal en «Perfil» ni contactos guardados para inferirlo.';
const NO_BUDGET = 'Se acabó el presupuesto del mes para el contacto del día.';
const TOO_FEW = 'La búsqueda no trajo contactos nuevos con correo.';
const NOBODY = 'La búsqueda no encontró personas con correo verificado para ese cliente ideal.';
/** A drop that came empty for lack of a customer: nothing was searched, so it is made again once there is one. */
const withoutCustomer = (drop: { status: string; criteria?: unknown }) => drop.status === 'empty' && !Array.isArray((drop.criteria as DropCriteria | null)?.titles);

/**
 * Plans today's drops of an organization for the people given: each one's customer (theirs, a teammate's or what the team
 * saved), one Leads Finder search per customer, a different contact for each person (DROP_SIZE), kept in the vault and in a
 * «pending» drop that `writeDrop` completes. Whoever has no customer to go by, or when the month's budget ran out, gets
 * an «empty» drop with the reason, so later runs do not try again.
 */
export async function planOrganizationDrops(client: Client, organizationId: string, people: string[], deps: {
  now: Date; search?: Search; budgetUsd: number; spentUsd: number; usdPerLead?: number;
  /** Today's rows exist already, «pending» and empty, taken by `pullDrop` before searching: they are completed, not added. */
  claimed?: boolean;
}) {
  const today = dayInZone(deps.now);
  const search = deps.search ?? searchLeadsFinder;
  const usdPerLead = deps.usdPerLead ?? leadsFinderUsdPerLead();
  const team = await teamOf(client, organizationId);

  // One search per customer; each person keeps where theirs came from («tu cliente ideal» or the team's).
  const groups = new Map<string, { criteria: DropCriteria; people: string[]; own: Map<string, DropCriteria> }>();
  const results: Array<{ userId: string; status: 'pending' | 'empty'; error?: string; items?: PendingItem[]; cost?: number; criteria?: DropCriteria }> = [];
  for (const userId of people) {
    const criteria = customerOf(userId, team);
    if (!criteria) { results.push({ userId, status: 'empty', error: NO_CUSTOMER }); continue; }
    const key = criteriaKey(criteria);
    const group = groups.get(key) || { criteria, people: [], own: new Map<string, DropCriteria>() };
    group.people.push(userId);
    group.own.set(userId, criteria);
    groups.set(key, group);
  }

  const known = groups.size ? await knownPeople(client, organizationId, deps.now) : { emails: new Set<string>(), linkedins: new Set<string>(), leadIds: new Set<string>() };
  let spent = deps.spentUsd;
  for (const { criteria, people: members, own } of groups.values()) {
    const count = searchCount(members.length);
    if (spent + count * usdPerLead > deps.budgetUsd) {
      for (const userId of members) results.push({ userId, status: 'empty', error: NO_BUDGET, criteria: own.get(userId) });
      continue;
    }
    let found: Awaited<ReturnType<Search>>;
    try {
      // The run's cap, not its cost (that comes from what it returns): one person's search is too small for a cap of its
      // own, which Apify refuses under its minimum, so never below an ordinary search's (leadsFinderMaxRunUsd).
      const deps = { fetch: globalThis.fetch, token: process.env.APIFY_TOKEN, maxRunUsd: Math.max(leadsFinderMaxRunUsd(), Math.min(1, count * usdPerLead * 1.5)) };
      const narrow = searchInput(criteria, count);
      found = await search(narrow, deps);
      // Nobody with those industries or sizes: once more with the titles and places only.
      if (!found.results.length && (narrow.industryKeywords.length || narrow.employeeRanges.length)) {
        const broad = await search(searchInput(criteria, count, true), deps);
        found = { ...broad, costUsd: found.costUsd + broad.costUsd };
      }
    } catch (error) {
      for (const userId of members) results.push({ userId, status: 'empty', error: `La búsqueda falló: ${text((error as Error)?.message, 200)}`, criteria: own.get(userId) });
      continue;
    }
    spent += found.costUsd;
    const entries = new Map<string, VaultEntry>(found.results.map(entry => [entry.lead.id, entry]));
    const assigned = assignDrops(found.results.map(candidateOf), members, known, criteria);
    const share = members.length ? Math.round((found.costUsd / members.length) * 10_000) / 10_000 : 0;
    for (const userId of members) {
      const picks = assigned.get(userId) || [];
      const mine = own.get(userId) || criteria;
      if (!picks.length) { results.push({ userId, status: 'empty', error: found.results.length ? TOO_FEW : NOBODY, cost: share, criteria: mine }); continue; }
      for (const pick of picks) { known.leadIds.add(pick.leadId); if (pick.emailKey) known.emails.add(pick.emailKey); }
      await storeInVault(client, { organizationId, userId, entries: picks.map(pick => entries.get(pick.leadId)!).filter(Boolean), now: deps.now.getTime() });
      results.push({ userId, status: 'pending', cost: share, criteria: mine, items: picks.map(pick => ({
        leadId: pick.leadId, name: pick.name, title: pick.title, company: pick.company, domain: pick.domain, industry: pick.industry, size: pick.size,
        city: pick.city, hasEmail: pick.hasEmail, hasPhone: pick.hasPhone, why: whyText(pick, mine), research: researchFacts({ ...pick, about: null }), draft: null,
        description: pick.about,
      })) });
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

/** The first email for one contact, by Cowork's Writer with its checks and its Reviewer, as Cowork would write it. */
async function draftFor(item: DropItem, userContext: Record<string, unknown> | null, generate: Generate, now: Date) {
  const brief: CoworkWriteBrief = {
    kind: 'email', recipients: [item.name], objective: `Primer correo de prospección para ${item.name}${item.title ? `, ${item.title}` : ''}${item.company ? ` en ${item.company}` : ''}.`,
    angle: null, tone: null, steps: null, notes: null, findings: null,
  };
  const observations = [{ action: 'leads.recommend', input: '', result: { leads: [{ name: item.name, company: item.company || '', title: item.title, industry: item.industry,
    companySize: item.size, city: item.city, companyFacts: item.research } ] } }];
  const models = coworkWriterModels();
  const efforts = coworkWriterEfforts();
  const output = await runCoworkWriter({
    request: `Escríbele un primer correo a ${item.name}${item.title ? `, ${item.title}` : ''}${item.company ? ` en ${item.company}` : ''}.`,
    brief, userContext, observations, now,
    generate: async ({ role, schema, systemPrompt, prompt, fix }) => {
      const chosen = coworkWriterCallModel('email', role, fix, models, efforts);
      return generate({ schema, systemPrompt, prompt, openAiModel: chosen.model, reasoningEffort: chosen.effort,
        maxOutputTokens: role === 'writer' ? 6000 : 1500, timeoutMs: role === 'writer' ? 40_000 : 20_000 });
    },
    step: async () => {},
  });
  const block = coworkWriterBlocks(output).find(entry => entry.type === 'email_draft') as { subject?: string; body?: string } | undefined;
  return block?.subject && block.body ? { subject: text(block.subject, 200), body: String(block.body).trim().slice(0, 4000) } : null;
}

/** Completes a pending drop: what each company does and a first email for each contact. A draft that fails leaves the contact without one. */
export async function writeDrop(client: Client, drop: { id: string; organization_id: string; user_id: string; items: PendingItem[] }, deps: {
  generate: Generate; now: Date; parallel?: number;
}) {
  const scope = { organizationId: drop.organization_id, userId: drop.user_id };
  const [userContext, about] = await Promise.all([
    loadCoworkUserContext(client, scope, { memories: true, mailbox: false }),
    summarizeCompanies(drop.items, deps.generate),
  ]);
  // The description stays out of the saved drop: what reaches the person is its summary.
  const items: DropItem[] = drop.items.map(({ description: _description, ...item }) => ({
    ...item, research: about.has(item.leadId) ? [about.get(item.leadId)!, ...item.research].slice(0, 3) : item.research,
  }));
  const parallel = Math.max(1, deps.parallel ?? 3);
  for (let start = 0; start < items.length; start += parallel) {
    await Promise.all(items.slice(start, start + parallel).map(async item => {
      item.draft = await draftFor(item, userContext as Record<string, unknown> | null, deps.generate, deps.now).catch(() => null);
    }));
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

/** The person's latest drop of the last week with something left to save, for «Hoy», with the next one to save. */
export async function latestDrop(client: Client, scope: DropScope, now: Date) {
  const since = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const result: any = await client.from('lead_drops').select('id,drop_date,status,items').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .in('status', ['ready', 'sent']).gte('drop_date', since).order('drop_date', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new LeadDropsError('No pudimos leer tu contacto del día.', 503);
  const items = (result.data?.items || []) as DropItem[];
  const unsaved = items.filter(item => !item.savedLeadId);
  if (!result.data || !unsaved.length) return null;
  const { name, company, why } = unsaved[0];
  return { id: String(result.data.id), dropDate: String(result.data.drop_date), total: items.length, left: unsaved.length, next: { name, company, why } };
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
  const fresh = !last || withoutCustomer(last);
  if (!fresh && (today || !dropDay(now))) return null;
  if (!customerOf(scope.userId, await teamOf(client, scope.organizationId))) return 'profile';
  if ((await monthSpend(client, now)) + searchCount(1) * leadsFinderUsdPerLead() > dropsMonthlyUsd()) return null;
  return fresh ? 'first' : 'today';
}

/**
 * What «Hoy» shows: the last drop with a contact left to save; on drop days, today's comes first (offered, or on its
 * way), so one nobody saved does not hold back the new one.
 */
export async function homeDrop(client: Client, scope: DropScope, now: Date) {
  const drop = await latestDrop(client, scope, now);
  if (drop?.dropDate === dayInZone(now)) return { drop, pull: null };
  const pull = await pullStatus(client, scope, now);
  if (drop && pull !== 'today' && pull !== 'preparing') return { drop, pull: null };
  return { drop: null, pull };
}

/** Why a drop came empty, said to the person, and the button to «Perfil» when completing the customer helps. */
export function emptyReason(error: string | null, now: Date): { title: string; text: string; profile: string | null } {
  if (error === NO_CUSTOMER) return { title: 'Falta tu cliente ideal', text: 'Con él elegimos tu contacto: a quién le vendes, en qué rubro y dónde. Toma un minuto en «Perfil».', profile: 'Completar mi cliente ideal' };
  if (error === NO_BUDGET) return { title: 'Por este mes no quedan contactos', text: 'Este mes ya se usaron todos los contactos del día: vuelven el próximo mes. Mientras, puedes buscar con tus filtros.', profile: null };
  if (error === TOO_FEW) return { title: 'Esta vez no hubo un contacto nuevo', text: 'Tu equipo ya tiene a muchos de los que calzan con tu cliente ideal. Sumar cargos, rubros o lugares trae contactos nuevos.', profile: 'Ampliar mi cliente ideal' };
  if (error === NOBODY) return { title: 'Esta vez no encontramos a nadie', text: 'Con tu cliente ideal no encontramos personas con correo verificado. Sumar cargos o lugares en «Perfil» ayuda.', profile: 'Ampliar mi cliente ideal' };
  return { title: 'La búsqueda no respondió', text: `Esta vez no pudimos traer tu contacto. El próximo llega ${nextDropDay(now)}; mientras, puedes buscar con tus filtros.`, profile: null };
}

/** A pending drop nobody finished writing in this time (the request that planned it died) is written by the next one. */
const STALLED_MS = 4 * 60_000;

/**
 * Today's drop of one person, made now when «Hoy» offers it (pullStatus): one search and the first email, a minute or
 * two, as the morning run makes it. Today's row is taken before searching, so a second request (another tab, or back
 * from «Hoy») answers «pending» instead of searching again: ask again. An «empty» one says why (emptyReason); without a
 * customer nothing is searched nor kept, so it is made once there is one.
 */
export async function pullDrop(client: Client, scope: DropScope, deps: { now: Date; generate: Generate; search?: Search }) {
  const today = dayInZone(deps.now);
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
      now: deps.now, search: deps.search, budgetUsd: dropsMonthlyUsd(), spentUsd: await monthSpend(client, deps.now), claimed: true,
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
    if (offer === 'profile') return { id: null, status: 'empty', reason: emptyReason(NO_CUSTOMER, deps.now) };
    if (offer !== 'first' && offer !== 'today') {
      const broke = dropsEnabled() && (await monthSpend(client, deps.now)) + searchCount(1) * leadsFinderUsdPerLead() > dropsMonthlyUsd();
      throw new LeadDropsError(!dropsEnabled() ? 'El contacto del día está en pausa.'
        : broke ? 'Este mes ya se usaron todos los contactos del día: vuelven el próximo mes.' : `Tu próximo contacto llega ${nextDropDay(deps.now)}.`, 409);
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
    await writeDrop(client, drop, { generate: deps.generate, now: deps.now });
    drop = (await read()) || drop;
  }
  return { id: drop.id, status: drop.status, reason: drop.status === 'empty' ? emptyReason(drop.error, deps.now) : null };
}

/**
 * Saves contacts of a drop in «Por escribir», with their email (and phone, when the search brought one) out of the vault:
 * no credits and no other search. Someone already in «Por escribir» with the same email is linked, not duplicated. The
 * research and the first email go with the contact (`data.leadDrop`).
 */
export async function saveDropLeads(client: Client, scope: DropScope, dropId: string, leadIds?: string[], options: { now?: Date } = {}) {
  const drop = await readDrop(client, scope, dropId);
  const wanted = drop.items.filter(item => !item.savedLeadId && (!leadIds || leadIds.includes(item.leadId)));
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
    const inserted: any = await client.from('enriched_leads').insert({ ...row, data: { ...row.data, leadDrop: { dropId, why: item.why, research: item.research, draft: item.draft } } })
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

/** Text the PDF's standard fonts can draw: typographic quotes and dashes become plain ones, anything else is dropped. */
export function pdfSafe(value: string) {
  return value.normalize('NFC').replace(/[‘’′]/g, "'").replace(/[“”″«»]/g, '"').replace(/[–—−‑]/g, '-').replace(/…/g, '...').replace(/•/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, '');
}

/** «Contacto del día» as a PDF: for each contact, why it fits, the brief research and the first email. */
export async function dropPdf(items: DropItem[], meta: { name: string; date: string; link: string }) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 22;
  const space = (height: number) => { if (y + height > 278) { pdf.addPage(); y = 22; } };
  const write = (value: string, size = 10, color: [number, number, number] = [30, 41, 59], bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(...color);
    for (const line of pdf.splitTextToSize(pdfSafe(value), 176) as string[]) { space(6); pdf.text(line, 17, y); y += size >= 14 ? 7 : 5; }
  };
  write('Contacto del día', 18, [17, 24, 39], true); y += 1;
  write(`${meta.name ? `Para ${meta.name} · ` : ''}${meta.date}`, 10, [100, 116, 139]); y += 3;
  write(items.length === 1 ? 'Tiene su correo listo en ANTON.IA. Guardarlo no gasta créditos.' : 'Cada contacto tiene su correo listo en ANTON.IA. Guardarlos no gasta créditos.', 10, [71, 85, 105]);
  write(meta.link, 9, [37, 99, 235]); y += 4;
  items.forEach((item, index) => {
    space(40);
    pdf.setDrawColor(226, 232, 240); pdf.line(17, y, 193, y); y += 7;
    write(items.length === 1 ? item.name : `${index + 1}. ${item.name}`, 13, [17, 24, 39], true);
    write([item.title, item.company].filter(Boolean).join(' · '), 10, [71, 85, 105]); y += 2;
    write('Por qué te lo recomiendo', 9, [100, 116, 139], true); write(item.why); y += 1;
    if (item.research.length) { write('Breve investigación', 9, [100, 116, 139], true); item.research.forEach(fact => write(`- ${fact}`)); y += 1; }
    if (item.draft) {
      write('Primer correo sugerido', 9, [100, 116, 139], true);
      write(`Asunto: ${item.draft.subject}`, 10, [17, 24, 39], true);
      item.draft.body.split(/\n+/).forEach(paragraph => { write(paragraph); y += 1; });
    }
    y += 3;
  });
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) { pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(148, 163, 184); pdf.text(`ANTON.IA · Página ${page} de ${pages}`, 17, 289); }
  return Buffer.from(pdf.output('arraybuffer'));
}
