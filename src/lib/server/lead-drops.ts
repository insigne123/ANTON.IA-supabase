import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { dayInZone } from '@/lib/admin/chile-time';
import { coworkWriterBlocks, runCoworkWriter, type CoworkWriteBrief } from '@/lib/cowork/writer';
import {
  DROP_SIZE, assignDrops, criteriaKey, dropCriteria, researchFacts, whyText,
  type DropCandidate, type DropCriteria, type DropItem, type IcpDeclared, type KnownPeople,
} from '@/lib/lead-drops';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import type { LeadSearchInput } from '@/lib/server/apollo-provider/validation';
import { loadCoworkUserContext } from '@/lib/server/cowork/user-context';
import { coworkWriterCallModel, coworkWriterEfforts, coworkWriterModels } from '@/lib/server/cowork/writer-run';
import { leadsFinderUsdPerLead, searchLeadsFinder } from '@/lib/server/leads-finder/client';
import { enrichedLeadRow } from '@/lib/server/leads-finder/reveal';
import { forgetInVault, readFromVault, storeInVault, type VaultEntry } from '@/lib/server/leads-finder/vault';

/** The reads, the preparation and the save of «Contactos de la semana» (src/lib/lead-drops.ts). Server only. */
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

/** A Leads Finder result as a candidate: what the screen may show, and the email and LinkedIn only as keys to skip known people. */
function candidateOf(entry: VaultEntry): DropCandidate {
  const { lead, contact } = entry;
  return {
    leadId: lead.id, name: text(contact.fullName, 200) || text(lead.name, 200), title: text(lead.title, 160) || null,
    company: text(lead.organization_name, 200) || null, domain: text(lead.organization_domain, 253) || null,
    industry: text(lead.organization_industry, 160) || null, size: typeof lead.organization_size === 'number' ? lead.organization_size : null,
    city: text(lead.city, 160) || null, hasEmail: Boolean(contact.email), hasPhone: Boolean(contact.mobileNumber),
    emailKey: contact.email ? contact.email.toLowerCase() : null, linkedinKey: contact.linkedinUrl ? contact.linkedinUrl.toLowerCase().replace(/\/$/, '') : null,
    about: text(lead.organization?.short_description, 600) || null,
  };
}

const searchInput = (criteria: DropCriteria, count: number): LeadSearchInput => ({
  provider: 'apollo' as LeadSearchInput['provider'], searchMode: 'batch', revealEmail: false, revealPhone: false, organizationDomains: [],
  titles: criteria.titles, seniorities: [], industryKeywords: criteria.industries, companyKeywords: [], companyLocations: [],
  personLocations: criteria.locations, employeeRanges: criteria.sizes, includeSimilarTitles: true, maxResults: count,
});

/**
 * Plans today's drops of an organization for the people given: each one's customer (theirs, a teammate's or what the team
 * saved), one Leads Finder search per customer, five different contacts for each person, kept in the vault and in a
 * «pending» drop that `writeDrop` completes. Whoever has no customer to go by, or when the month's budget ran out, gets
 * an «empty» drop with the reason, so later runs do not try again.
 */
export async function planOrganizationDrops(client: Client, organizationId: string, people: string[], deps: {
  now: Date; search?: Search; budgetUsd: number; spentUsd: number; usdPerLead?: number;
}) {
  const today = dayInZone(deps.now);
  const search = deps.search ?? searchLeadsFinder;
  const usdPerLead = deps.usdPerLead ?? leadsFinderUsdPerLead();
  const [members, saved]: any[] = await Promise.all([
    client.from('organization_members').select('user_id,role').eq('organization_id', organizationId),
    client.from('enriched_leads').select('title,organization_industry').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(1000),
  ]);
  if (members.error || saved.error) throw new LeadDropsError('No pudimos leer el equipo.', 503);
  const memberIds = (members.data || []).map((row: any) => String(row.user_id));
  const profiles: any = memberIds.length ? await client.from('profiles').select('id,full_name,company_name,company_domain,job_title,signatures').in('id', memberIds) : { data: [] };
  if (profiles.error) throw new LeadDropsError('No pudimos leer los perfiles.', 503);
  const byId = new Map<string, any>(((profiles.data || []) as any[]).map(row => [String(row.id), row]));
  // Admins first: their customer speaks for the team when a person has none.
  const rank = (id: string) => ['owner', 'admin'].includes(String((members.data || []).find((row: any) => String(row.user_id) === id)?.role)) ? 0 : 1;
  const team = memberIds.slice().sort((a: string, b: string) => rank(a) - rank(b));
  const savedRows = ((saved.data || []) as any[]).map(row => ({ title: row.title, industry: row.organization_industry }));

  // One search per customer; each person keeps where theirs came from («tu cliente ideal» or the team's).
  const groups = new Map<string, { criteria: DropCriteria; people: string[]; own: Map<string, DropCriteria> }>();
  const results: Array<{ userId: string; status: 'pending' | 'empty'; error?: string; items?: PendingItem[]; cost?: number; criteria?: DropCriteria }> = [];
  for (const userId of people) {
    const criteria = dropCriteria(declaredOf(byId.get(userId)), team.filter((id: string) => id !== userId).map((id: string) => declaredOf(byId.get(id))), savedRows);
    if (!criteria) { results.push({ userId, status: 'empty', error: 'Sin cliente ideal en «Perfil» ni contactos guardados para inferirlo.' }); continue; }
    const key = criteriaKey(criteria);
    const group = groups.get(key) || { criteria, people: [], own: new Map<string, DropCriteria>() };
    group.people.push(userId);
    group.own.set(userId, criteria);
    groups.set(key, group);
  }

  const known = groups.size ? await knownPeople(client, organizationId, deps.now) : { emails: new Set<string>(), linkedins: new Set<string>(), leadIds: new Set<string>() };
  let spent = deps.spentUsd;
  for (const { criteria, people: members, own } of groups.values()) {
    // Twice what the group needs: some are known already, some have no email, and each person gets one per company.
    const count = Math.max(10, Math.min(100, members.length * DROP_SIZE * 2 + 5));
    if (spent + count * usdPerLead > deps.budgetUsd) {
      for (const userId of members) results.push({ userId, status: 'empty', error: 'Se acabó el presupuesto del mes para contactos de la semana.', criteria: own.get(userId) });
      continue;
    }
    let found: Awaited<ReturnType<Search>>;
    try {
      found = await search(searchInput(criteria, count), { fetch: globalThis.fetch, token: process.env.APIFY_TOKEN, maxRunUsd: Math.min(1, count * usdPerLead * 1.5) });
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
      if (picks.length < 3) { results.push({ userId, status: 'empty', error: 'La búsqueda no trajo suficientes contactos nuevos con correo.', cost: share, criteria: mine }); continue; }
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
    const inserted = await client.from('lead_drops').insert(row);
    if (inserted.error && inserted.error.code !== '23505') throw new LeadDropsError('No pudimos guardar los contactos de la semana.', 503);
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
  if (saved.error) throw new LeadDropsError('No pudimos guardar los contactos de la semana.', 503);
  return { written: items.filter(item => item.draft).length, items };
}

// ─── Reading, saving and the PDF ───────────────────────────────────────────────────────────────────────────────────

/** A drop of the person, in the selected organization; never another person's. */
export async function readDrop(client: Client, scope: DropScope, dropId: string) {
  const result: any = await client.from('lead_drops').select('id,drop_date,status,criteria,items,opened_at,saved_at,created_at')
    .eq('id', dropId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (result.error) throw new LeadDropsError('No pudimos leer tus contactos de la semana.', 503);
  if (!result.data || !['ready', 'sent'].includes(result.data.status)) throw new LeadDropsError('No encontramos esos contactos.', 404);
  return result.data as { id: string; drop_date: string; status: string; criteria: DropCriteria; items: DropItem[]; opened_at: string | null; saved_at: string | null };
}

/** The person's latest drop of the last week with something left to save, for «Hoy». */
export async function latestDrop(client: Client, scope: DropScope, now: Date) {
  const since = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const result: any = await client.from('lead_drops').select('id,drop_date,status,items').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .in('status', ['ready', 'sent']).gte('drop_date', since).order('drop_date', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new LeadDropsError('No pudimos leer tus contactos de la semana.', 503);
  const items = (result.data?.items || []) as DropItem[];
  const left = items.filter(item => !item.savedLeadId).length;
  return result.data && left ? { id: String(result.data.id), dropDate: String(result.data.drop_date), total: items.length, left } : null;
}

/**
 * Saves contacts of a drop in «Por escribir», with their email (and phone, when the search brought one) out of the vault:
 * no credits and no other search. Someone already in «Por escribir» with the same email is linked, not duplicated. The
 * research and the first email go with the contact (`data.leadDrop`).
 */
export async function saveDropLeads(client: Client, scope: DropScope, dropId: string, leadIds?: string[]) {
  const drop = await readDrop(client, scope, dropId);
  const wanted = drop.items.filter(item => !item.savedLeadId && (!leadIds || leadIds.includes(item.leadId)));
  if (!wanted.length) return { saved: [], expired: [], items: drop.items };
  const vault = await readFromVault(client, { organizationId: scope.organizationId, ids: wanted.map(item => item.leadId) });
  const now = new Date().toISOString();
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

/** «Contactos de la semana» as a PDF: for each contact, why it fits, the brief research and the first email. */
export async function dropPdf(items: DropItem[], meta: { name: string; date: string; link: string }) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 22;
  const space = (height: number) => { if (y + height > 278) { pdf.addPage(); y = 22; } };
  const write = (value: string, size = 10, color: [number, number, number] = [30, 41, 59], bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(...color);
    for (const line of pdf.splitTextToSize(pdfSafe(value), 176) as string[]) { space(6); pdf.text(line, 17, y); y += size >= 14 ? 7 : 5; }
  };
  write('Contactos de la semana', 18, [17, 24, 39], true); y += 1;
  write(`${meta.name ? `Para ${meta.name} · ` : ''}${meta.date}`, 10, [100, 116, 139]); y += 3;
  write('Cada contacto tiene su correo listo en ANTON.IA. Guardarlos no gasta créditos.', 10, [71, 85, 105]);
  write(meta.link, 9, [37, 99, 235]); y += 4;
  items.forEach((item, index) => {
    space(40);
    pdf.setDrawColor(226, 232, 240); pdf.line(17, y, 193, y); y += 7;
    write(`${index + 1}. ${item.name}`, 13, [17, 24, 39], true);
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
