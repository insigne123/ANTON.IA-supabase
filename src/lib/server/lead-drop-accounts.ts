import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { DropCriteria } from '@/lib/lead-drops';
import type { FinderLessons, FinderPreferences, FinderSeller } from '@/lib/server/lead-drop-finder';
import type { VaultEntry } from '@/lib/server/leads-finder/vault';

/**
 * «Contacto del día» by company (16 Nov 2026, docs/contacto-del-dia.md). The owner, on seeing the filters of a drop: «lo mejor para
 * buscar más es buscar por empresa o industrias, evaluar cada empresa por separado y obtener todo el listado de trabajadores y ahí
 * sacar los puestos que sean interesantes: las empresas son las que pagan», and «¿qué pasará cuando ya no halles más leads?».
 *
 * A search by role alone is answered with the people of the two or three largest companies (the first 25 heads of «forestal» in
 * Chile are all of one company), and runs out when those were offered. So the finder also keeps the companies of the customer:
 *
 * 1. it finds them through their heads (the owners and general managers of the customer's industries: one or two a company);
 * 2. it scores each company once for what the team sells, with a reason the person can read (scoreAccounts);
 * 3. each day it opens the best ones that still have people to offer and brings their people, whatever their title, so the score
 *    of the people chooses who decides and who can refer (lead-drop-finder.ts);
 * 4. it remembers which ones ran out, to go on to the next;
 * 5. when the customer's own industries have few people left, it widens to the industries next to them (expansionIndustries).
 *
 * Every search here is Apollo's free people search. Everything is best effort: without the table or with the model down the
 * finder works as before, by role.
 */

type Client = SupabaseClient;
type Generate = (options: { schema: z.ZodTypeAny; systemPrompt: string; prompt: string; openAiModel?: string; reasoningEffort?: any;
  maxOutputTokens: number; timeoutMs: number }) => Promise<any>;

export type DropAccount = {
  domain: string; name: string; industry: string | null; size: number | null; about: string | null;
  /** How much the company would need what the team sells, 0 to 10, and why in one sentence: null until scored. */
  score: number | null; reason: string | null;
  /** «expansion»: found in an industry next to the customer's, named in `segment`. */
  origin: 'customer' | 'expansion'; segment: string | null;
  /** People worth offering it still had the last time it was opened: 0 means it ran out. */
  peopleLeft: number | null; openedAt: string | null; scoredAt: string | null;
};

/** A company with this score or more is opened: its people are brought and scored. */
export const ACCOUNT_FIT = 6;
/** How many companies are opened a day for a group, and scored a day at most. */
export const ACCOUNTS_OPENED = 12;
const ACCOUNTS_SCORED = 200;
const SCORE_CHUNK = 40;
/** A company that ran out is opened again after this many days: people change jobs and Apollo finds more. */
const REST_DAYS = 30;
const DAY = 86_400_000;
const TABLE = 'lead_drop_accounts';

const clip = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const modelOf = () => process.env.LEAD_DROPS_FINDER_MODEL?.trim() || process.env.LEAD_DROPS_RESEARCH_MODEL?.trim() || 'claude-haiku-5-5';

/** A company's domain as its key: lower case, without «www.»; nothing when it is not a domain. */
export function accountDomain(value: unknown): string | null {
  const domain = clip(value, 253).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/** The companies of some people of a search, each once, with what the search said of them. */
export function accountsOf(entries: VaultEntry[], origin: DropAccount['origin'] = 'customer', segment: string | null = null): DropAccount[] {
  const found = new Map<string, DropAccount>();
  for (const { lead } of entries) {
    const domain = accountDomain(lead.organization_domain);
    if (!domain) continue;
    const known = found.get(domain);
    const about = clip((lead as { organization?: { short_description?: unknown } }).organization?.short_description, 400) || null;
    if (known) { known.about ||= about; known.industry ||= clip(lead.organization_industry, 120) || null; known.size ??= typeof lead.organization_size === 'number' ? lead.organization_size : null; continue; }
    found.set(domain, { domain, name: clip(lead.organization_name, 200), industry: clip(lead.organization_industry, 120) || null,
      size: typeof lead.organization_size === 'number' ? lead.organization_size : null, about, score: null, reason: null, origin, segment,
      peopleLeft: null, openedAt: null, scoredAt: null });
  }
  return [...found.values()];
}

const scoreSchema = z.object({
  companies: z.array(z.object({ i: z.number().int().min(0), nota: z.number().int().min(0).max(10), razon: z.string().max(220).nullable().optional() }).strict()).max(SCORE_CHUNK),
}).strict();

const SCORE_PROMPT = [
  'Ayudas a un vendedor B2B a elegir a qué empresas acercarse. Recibes lo que vende (vendedor), a quién le vende (cliente_ideal), lo que su equipo',
  'hizo con contactos anteriores (aprendizaje) y una lista de empresas. Por cada empresa entrega una nota y una razón.',
  '',
  '«nota», de 0 a 10: cuánto necesitaría esa empresa lo que vende, por lo que hace, su rubro, su tamaño y su lugar. Si solo viene el nombre, usa lo',
  'que sabes de esa empresa. Usa toda la escala.',
  '- 9 o 10: es del rubro objetivo y tiene la operación que necesita lo que se vende.',
  '- 6 a 8: rubro vecino o necesidad plausible.',
  '- 3 a 5: no la conoces o faltan datos para decirlo.',
  '- 1 o 2: improbable.',
  '- 0: no calza: competidor del vendedor, otro país o un rubro sin relación.',
  'Distingue a quien opera (tiene faenas, plantas, instalaciones, tiendas o personal propio) de quien solo le vende a esos operadores (proveedores,',
  'distribuidores, consultoras, asociaciones gremiales): si lo que se vende es para quien opera, un proveedor del mismo rubro es 3 o menos.',
  '',
  '«razon»: una frase de hasta 140 caracteres, en español y dicha al vendedor, de por qué esa empresa necesitaría lo que vende, a partir de lo que',
  'la empresa hace. Solo hechos que vengan en los datos o que sepas con certeza de esa empresa: sin cifras ni noticias inventadas, sin «podría ser',
  'interesante». Con una nota de 5 o menos puede ser null.',
  '',
  'Usa el aprendizaje: sube a las que se parecen a las que le sirvieron y baja a las que se parecen a las que descartó. Si viene «en_sus_palabras»',
  '(lo que el equipo escribió sobre qué ofrece y a quién busca), manda sobre las listas de rubros: sube a las que calzan con lo que describe y deja',
  'en 2 o menos a las que dice que no le sirven. Responde JSON conforme al contrato, con el número (i) de cada empresa.',
].join('\n');

/**
 * A score and a reason for each company not scored yet, in place: at most ACCOUNTS_SCORED a day, the rest another day. A company the
 * model does not answer for stays without a score, so it is asked again.
 */
export async function scoreAccounts(input: {
  accounts: DropAccount[]; criteria: DropCriteria; seller: FinderSeller | null; lessons?: FinderLessons; preferences?: FinderPreferences;
  generate?: Generate; now: Date;
}): Promise<number> {
  const generate = input.generate;
  const pending = input.accounts.filter(account => account.score === null).slice(0, ACCOUNTS_SCORED);
  if (!generate || !pending.length) return 0;
  const notes = clip(input.preferences?.teamNotes, 1200) || clip(input.preferences?.notes, 1200);
  const context = {
    vendedor: input.seller ? {
      empresa: clip(input.seller.company, 120) || null, oferta: clip(input.seller.offer, 600) || null,
      servicios: (input.seller.services || []).slice(0, 8).map(value => clip(value, 120)), rubro: clip(input.seller.sector, 120) || null,
    } : null,
    cliente_ideal: { cargos: input.criteria.titles, rubros: input.criteria.industries, lugares: input.criteria.locations, tamanos: input.criteria.sizes },
    aprendizaje: { le_sirvieron: (input.lessons?.liked || []).slice(0, 10), descarto: (input.lessons?.disliked || []).slice(0, 10) },
    ...(notes ? { en_sus_palabras: notes } : {}),
  };
  const chunks = Array.from({ length: Math.ceil(pending.length / SCORE_CHUNK) }, (_, index) => pending.slice(index * SCORE_CHUNK, (index + 1) * SCORE_CHUNK));
  let scored = 0;
  await Promise.all(chunks.map(async chunk => {
    const answer = await generate({
      schema: scoreSchema, systemPrompt: SCORE_PROMPT, openAiModel: modelOf(), reasoningEffort: 'low', maxOutputTokens: 800 + chunk.length * 70, timeoutMs: 40_000,
      prompt: JSON.stringify({ ...context, empresas: chunk.map((account, i) => ({
        i, empresa: account.name, sitio: account.domain, rubro: account.industry, empleados: account.size, descripcion: clip(account.about, 300) || null,
        ...(account.segment ? { encontrada_en: account.segment } : {}),
      })) }),
    }).catch(() => null);
    const parsed = answer ? scoreSchema.safeParse(answer) : null;
    for (const entry of parsed?.success ? parsed.data.companies : []) {
      const target = chunk[entry.i];
      if (!target || target.score !== null) continue;
      target.score = entry.nota;
      target.reason = clip(entry.razon, 200) || null;
      target.scoredAt = input.now.toISOString();
      scored++;
    }
  }));
  return scored;
}

/**
 * The companies to open today: the ones that fit (ACCOUNT_FIT) and did not run out in the last REST_DAYS, the best first and,
 * among equals, the one opened longest ago (never, first), so the companies of a same score take turns.
 */
export function accountsToOpen(accounts: DropAccount[], now: Date, max = ACCOUNTS_OPENED): DropAccount[] {
  const resting = (account: DropAccount) => account.peopleLeft === 0 && account.openedAt !== null && now.getTime() - Date.parse(account.openedAt) < REST_DAYS * DAY;
  return accounts.filter(account => (account.score ?? -1) >= ACCOUNT_FIT && !resting(account))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.openedAt || '').localeCompare(b.openedAt || '') || a.domain.localeCompare(b.domain))
    .slice(0, max);
}

const expansionSchema = z.object({ rubros: z.array(z.object({ rubro: z.string().min(2).max(60), palabras: z.array(z.string().min(2).max(40)).max(3) }).strict()).max(4) }).strict();

const EXPANSION_PROMPT = [
  'Un vendedor B2B ya contactó a casi todas las personas de los rubros de su cliente ideal. Propón hasta cuatro rubros vecinos donde lo que vende',
  'también se necesita: empresas con la misma clase de operación, de riesgo o de problema, en los mismos lugares. Nunca uno de los rubros que ya',
  'busca, ni el del propio vendedor, ni proveedores o consultoras de esos rubros. Respeta lo que el equipo escribió en «en_sus_palabras» y lo que',
  'descartó en «aprendizaje». Por cada rubro: «rubro», su nombre en español como lo diría el vendedor (una a tres palabras), y «palabras», de una a',
  'tres palabras clave con las que una empresa de ese rubro se describe en LinkedIn (en español o en inglés, en minúsculas, una o dos palabras cada',
  'una). Si no hay un rubro vecino razonable, responde la lista vacía. Responde JSON conforme al contrato.',
].join('\n');

/** Industries next to the customer's where what the team sells is needed too, each with the words its companies describe themselves with. */
export async function expansionIndustries(input: {
  criteria: DropCriteria; seller: FinderSeller | null; lessons?: FinderLessons; preferences?: FinderPreferences; generate?: Generate;
}): Promise<Array<{ industry: string; keywords: string[] }>> {
  if (!input.generate) return [];
  const notes = clip(input.preferences?.teamNotes, 1200) || clip(input.preferences?.notes, 1200);
  const answer = await input.generate({
    schema: expansionSchema, systemPrompt: EXPANSION_PROMPT, openAiModel: modelOf(), reasoningEffort: 'low', maxOutputTokens: 500, timeoutMs: 25_000,
    prompt: JSON.stringify({
      vendedor: input.seller ? { empresa: clip(input.seller.company, 120) || null, oferta: clip(input.seller.offer, 600) || null,
        servicios: (input.seller.services || []).slice(0, 8).map(value => clip(value, 120)), rubro: clip(input.seller.sector, 120) || null } : null,
      cliente_ideal: { cargos: input.criteria.titles, rubros: input.criteria.industries, lugares: input.criteria.locations },
      aprendizaje: { le_sirvieron: (input.lessons?.liked || []).slice(0, 10), descarto: (input.lessons?.disliked || []).slice(0, 10) },
      ...(notes ? { en_sus_palabras: notes } : {}),
    }),
  }).catch(() => null);
  const parsed = answer ? expansionSchema.safeParse(answer) : null;
  if (!parsed?.success) return [];
  const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const own = new Set(input.criteria.industries.map(fold));
  const seen = new Set<string>();
  return parsed.data.rubros.flatMap(entry => {
    const industry = clip(entry.rubro, 60);
    const key = fold(industry);
    if (!industry || own.has(key) || seen.has(key)) return [];
    seen.add(key);
    const keywords = [...new Set(entry.palabras.map(word => clip(word, 40).toLowerCase()).filter(Boolean))];
    return keywords.length ? [{ industry, keywords }] : [];
  });
}

/** The companies kept for a customer of an organization, by domain; none when the table cannot be read (it is not there yet). */
export async function readAccounts(client: Client, organizationId: string, customerKey: string): Promise<Map<string, DropAccount>> {
  const accounts = new Map<string, DropAccount>();
  for (let from = 0; from < 5000; from += 1000) {
    const page: any = await client.from(TABLE).select('domain,name,industry,size,score,reason,origin,segment,people_left,opened_at,scored_at')
      .eq('organization_id', organizationId).eq('customer_key', customerKey).order('domain').range(from, from + 999);
    if (page.error) return accounts;
    for (const row of page.data || []) {
      accounts.set(String(row.domain), { domain: String(row.domain), name: clip(row.name, 200), industry: row.industry ?? null, size: typeof row.size === 'number' ? row.size : null,
        about: null, score: typeof row.score === 'number' ? row.score : null, reason: row.reason ?? null, origin: row.origin === 'expansion' ? 'expansion' : 'customer',
        segment: row.segment ?? null, peopleLeft: typeof row.people_left === 'number' ? row.people_left : null, openedAt: row.opened_at ?? null, scoredAt: row.scored_at ?? null });
    }
    if ((page.data || []).length < 1000) break;
  }
  return accounts;
}

/**
 * The companies the research of a drop found (18 Nov 2026). Apollo's free search names a person's company and nothing else: no site,
 * no industry, no size, so the search by company had nothing to keep a company by and never started (the first two real runs left
 * this table empty). The research of each contact does find the company's site and what it does (lead-drop-research.ts), so the
 * companies are learnt there: scored for what the team sells with what the research read, and kept for the next morning, when the
 * finder opens the best ones to bring the rest of their people.
 *
 * Only new companies are kept: one the table already has keeps its score and what was learnt on opening it. Best effort, as the rest.
 */
export async function learnResearchedAccounts(client: Client, input: {
  organizationId: string; customerKey: string; criteria: DropCriteria; seller: FinderSeller | null; generate?: Generate; now: Date;
  companies: Array<{ domain: string | null | undefined; name: string | null | undefined; industry?: string | null; size?: number | null; about?: string | null }>;
}): Promise<number> {
  const found = new Map<string, DropAccount>();
  for (const company of input.companies) {
    const domain = accountDomain(company.domain);
    const name = clip(company.name, 200);
    if (!domain || !name || found.has(domain)) continue;
    found.set(domain, { domain, name, industry: clip(company.industry, 120) || null, size: typeof company.size === 'number' ? company.size : null,
      about: clip(company.about, 400) || null, score: null, reason: null, origin: 'customer', segment: null, peopleLeft: null, openedAt: null, scoredAt: null });
  }
  if (!found.size || !/^[0-9a-f]{16}$/.test(input.customerKey)) return 0;
  const known: any = await Promise.resolve(client.from(TABLE).select('domain').eq('organization_id', input.organizationId).eq('customer_key', input.customerKey)
    .in('domain', [...found.keys()])).catch(() => ({ error: true }));
  if (known?.error) return 0;
  for (const row of known.data || []) found.delete(String(row.domain));
  const fresh = [...found.values()];
  if (!fresh.length) return 0;
  // With what the research read of each: a company the model does not answer for is kept without a score, and the finder asks again.
  await scoreAccounts({ accounts: fresh, criteria: input.criteria, seller: input.seller, generate: input.generate, now: input.now }).catch(() => 0);
  const rows = fresh.map(account => ({
    organization_id: input.organizationId, customer_key: input.customerKey, domain: account.domain, name: account.name, industry: account.industry, size: account.size,
    score: account.score, reason: account.reason, origin: account.origin, segment: account.segment, people_left: null, opened_at: null, scored_at: account.scoredAt,
    updated_at: input.now.toISOString(),
  }));
  const saved: any = await Promise.resolve(client.from(TABLE).upsert(rows, { onConflict: 'organization_id,customer_key,domain', ignoreDuplicates: true })).catch(() => ({ error: true }));
  return saved?.error ? 0 : rows.length;
}

/** Keeps the companies given (new ones, their score, and what was learnt on opening them). A failure is not told: the drop is made anyway. */
export async function saveAccounts(client: Client, organizationId: string, customerKey: string, accounts: DropAccount[], now: Date) {
  const rows = accounts.map(account => ({
    organization_id: organizationId, customer_key: customerKey, domain: account.domain, name: account.name, industry: account.industry, size: account.size,
    score: account.score, reason: account.reason, origin: account.origin, segment: account.segment, people_left: account.peopleLeft,
    opened_at: account.openedAt, scored_at: account.scoredAt, updated_at: now.toISOString(),
  }));
  for (let start = 0; start < rows.length; start += 500) {
    const saved: any = await Promise.resolve(client.from(TABLE).upsert(rows.slice(start, start + 500), { onConflict: 'organization_id,customer_key,domain' })).catch(() => ({ error: true }));
    if (saved?.error) return false;
  }
  return true;
}
