import { z } from 'zod';
import { withoutSourceTalk, type DropBrief } from '@/lib/lead-drops';
import { fetchCompanyHomePage } from '@/lib/server/native-research';
import { searchSerper, type SerperSearchItem } from '@/lib/server/serper-search';

/**
 * The short research of a «Contacto del día» (12 Nov 2026, docs/contacto-del-dia.md). Apollo's free search brings a name, a title and
 * a company, and nothing else: the contacts reached the person without a word about the company, and their emails read the same for
 * everyone. For each contact, before anything is written:
 *
 * 1. the web is asked twice (Serper): the company, to find its site and what it does, and its news;
 * 2. its home page is read, when the site can be told from the company's name;
 * 3. a small model (Claude Haiku) writes five lines for whoever sells: what the company does, what is happening there now, why what
 *    the team sells helps it, what that role cares about and how to open the conversation.
 *
 * It is read in an email, so each line is one sentence. The date and the source of the news are the search's, never the model's, and a
 * line with a figure the evidence does not have is left out. Best effort: without evidence there is no brief, and the contact goes on
 * as before.
 */

type Generate = (options: { schema: z.ZodTypeAny; systemPrompt: string; prompt: string; openAiModel?: string; reasoningEffort?: any;
  maxOutputTokens: number; timeoutMs: number }) => Promise<any>;
type Page = { title: string | null; description: string | null; text: string };

export type DropResearchSeller = { company?: string | null; offer?: string | null; services?: string[] | null; proofPoints?: string[] | null; sector?: string | null };
export type DropResearchInput = {
  organizationId: string;
  contact: { title: string | null; company: string | null; domain?: string | null; country?: string | null; industry?: string | null };
  seller: DropResearchSeller | null;
};
export type DropResearchDeps = {
  generate: Generate; now: Date;
  search?: (request: Parameters<typeof searchSerper>[0]) => Promise<{ items: SerperSearchItem[] }>;
  home?: (domain: string) => Promise<Page | null>;
};
export type DropResearch = { brief: DropBrief; domain: string | null };

const clip = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const fold = (value: unknown) => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const modelOf = () => process.env.LEAD_DROPS_RESEARCH_MODEL?.trim() || 'claude-haiku-5-5';
/** LEAD_DROPS_BRIEF=off leaves the contacts without it. */
export const dropBriefEnabled = (env: Record<string, string | undefined> = process.env) => env.LEAD_DROPS_BRIEF !== 'off';

// Words of a company name that are not its name: its legal form, its kind and the country.
const NAME_NOISE = new Set(['sa', 'spa', 'ltda', 'limitada', 'eirl', 'inc', 'corp', 'plc', 'llc', 'ltd', 'group', 'grupo', 'empresa', 'empresas', 'compania', 'cia',
  'sociedad', 'chile', 'peru', 'colombia', 'mexico', 'argentina', 'latam', 'south', 'america', 'the', 'del', 'los', 'las', 'servicios', 'ingenieria', 'construccion',
  'equipo', 'holding', 'internacional', 'international', 'nacional']);
/** The words that tell a company from another: «Atlantica Sustainable Infrastructure Plc» → atlantica, sustainable, infrastructure. */
export function companyTokens(name: string | null | undefined): string[] {
  return [...new Set(fold(name).split(' ').filter(word => word.length >= 3 && !NAME_NOISE.has(word)))];
}

// First words that many companies share: alone they do not say which one a text is about.
const COMMON_FIRST = new Set(['minera', 'constructora', 'inmobiliaria', 'clinica', 'banco', 'transportes', 'comercial', 'agricola', 'forestal', 'puerto', 'puertos',
  'universidad', 'hospital', 'laboratorio', 'laboratorios', 'industrias', 'industria', 'distribuidora', 'importadora', 'exportadora', 'sociedad', 'corporacion',
  'fundacion', 'instituto', 'colegio', 'municipalidad', 'cooperativa', 'pesquera', 'vina', 'salmones', 'energia', 'aguas', 'andina', 'nacional', 'central']);
/**
 * Whether a text speaks of the company: its name of one word, the first two words of a longer one together («minera andina»), or
 * its first word alone when that word is its own («liebherr»). «Cumbre andina de turismo» is not about Minera Andina.
 */
export function mentionsCompany(text: string | null | undefined, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const said = ` ${fold(text)} `;
  if (tokens.length === 1) return said.includes(` ${tokens[0]} `);
  return said.includes(` ${tokens[0]} ${tokens[1]} `) || (tokens[0].length >= 6 && !COMMON_FIRST.has(tokens[0]) && said.includes(` ${tokens[0]} `));
}
/** The company's name as the web says it, without its legal form: «Minera Andina S.A.» → «Minera Andina». */
export const searchName = (company: string) => company.replace(/(?:[\s,]+(?:S\.?\s?A\.?|SpA|Ltda\.?|Limitada|E\.?I\.?R\.?L\.?|Inc\.?|Corp\.?|Plc|LLC|Ltd\.?))+$/i, '').trim() || company;

// Sites that speak of a company without being its own.
const NOT_A_COMPANY_SITE = /(^|\.)(linkedin|facebook|instagram|twitter|x|youtube|tiktok|wikipedia|google|bloomberg|crunchbase|zoominfo|rocketreach|apollo|dnb|emis|glassdoor|indeed|computrabajo|trabajando|laborum|bumeran|mercadopublico|genealog|dateas|rutificador|empresite|cylex|paginasamarillas|amarillas|yelp|trustpilot|datosperu|universidadperu|infoempresa|sii|gob|df|latercera|emol|biobiochile|cooperativa|elmostrador|mch|mineriachilena|reporteminero|portalminero|revistaei|bnamericas)\.[a-z.]+$/;
/** The company's own site among the results: the first whose address has a word of its name and is not a directory, a network or a paper. */
export function companySite(company: string | null | undefined, items: SerperSearchItem[]): string | null {
  const tokens = companyTokens(company);
  if (!tokens.length) return null;
  for (const item of items) {
    let host: string;
    try { host = new URL(String(item.link || '')).hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
    if (NOT_A_COMPANY_SITE.test(host)) continue;
    const label = fold(host.split('.').slice(0, -1).join(' ')).replace(/ (com|co|net|org)$/, '').replace(/\s+/g, '');
    if (label.length >= 3 && tokens.some(token => label.includes(token) || (label.length >= 4 && token.includes(label)))) return host;
  }
  return null;
}

const COUNTRY_CODES: Array<[RegExp, string]> = [[/chile/, 'cl'], [/peru/, 'pe'], [/colombia/, 'co'], [/mexico/, 'mx'], [/argentina/, 'ar'], [/ecuador/, 'ec'], [/bolivia/, 'bo'], [/uruguay/, 'uy'], [/brasil|brazil/, 'br'], [/espana|spain/, 'es']];
const countryCode = (country: string | null | undefined) => COUNTRY_CODES.find(([pattern]) => pattern.test(fold(country)))?.[1] ?? 'cl';

const MONTHS: Record<string, number> = { ene: 0, jan: 0, feb: 1, mar: 2, abr: 3, apr: 3, may: 4, jun: 5, jul: 6, ago: 7, aug: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11, dec: 11 };
const UNIT_DAYS: Array<[RegExp, number]> = [[/^(minuto|minute|min|hora|hour|hr)/, 0], [/^(dia|day)/, 1], [/^(semana|week)/, 7], [/^(mes|month)/, 30], [/^(ano|year)/, 365]];
/** When a piece of news is from, as the search says it («hace 3 días», «12 oct 2026», «Oct 12, 2026»); null when it cannot be told. */
export function newsDate(value: string | null | undefined, now: Date): Date | null {
  const said = fold(value);
  if (!said) return null;
  const relative = said.match(/(?:hace )?(\d+|un|una|a|an) ([a-z]+)(?: ago)?/);
  if (relative && (said.startsWith('hace') || said.endsWith('ago'))) {
    const amount = /^\d+$/.test(relative[1]) ? Number(relative[1]) : 1;
    const days = UNIT_DAYS.find(([pattern]) => pattern.test(relative[2]))?.[1];
    return days === undefined ? null : new Date(now.getTime() - amount * days * 86_400_000);
  }
  const written = said.match(/(\d{1,2}) (?:de )?([a-z]{3})[a-z]* (?:de )?(\d{4})/) ?? null;
  if (written && MONTHS[written[2]] !== undefined) return new Date(Date.UTC(Number(written[3]), MONTHS[written[2]], Number(written[1]), 12));
  const english = said.match(/([a-z]{3})[a-z]* (\d{1,2}) (\d{4})/);
  if (english && MONTHS[english[1]] !== undefined) return new Date(Date.UTC(Number(english[3]), MONTHS[english[1]], Number(english[2]), 12));
  return null;
}
const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dateLabel = (date: Date) => `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
/** News older than this says little of what happens there now. */
const NEWS_MAX_DAYS = 540;

const briefSchema = z.object({
  empresa: z.string().max(400).nullable(),
  novedad: z.object({ n: z.number().int().min(0).max(9), texto: z.string().max(400) }).strict().nullable(),
  porque: z.string().max(400).nullable(),
  cargo: z.string().max(400).nullable(),
  apertura: z.string().max(400).nullable(),
}).strict();

const BRIEF_PROMPT = [
  'Preparas a un vendedor B2B para escribirle a una persona. Lo leerá en un correo, en diez segundos: cada campo es UNA frase corta y concreta, en',
  'español de Chile, sin adjetivos de marketing. Le hablas al vendedor (de tú); de la persona a quien le va a escribir hablas en tercera persona',
  '(«responde por…», nunca «respondes por…»). Recibes lo que vende (vendedor), a quién le va a escribir (contacto: su cargo y su',
  'empresa) y la evidencia encontrada en la web: la portada del sitio de la empresa (sitio), resultados de búsqueda (resultados) y noticias numeradas',
  '(noticias). Usa solo esa evidencia: no inventes cifras, clientes, proyectos, fechas ni hechos, y no uses lo que sabes de la empresa si la evidencia',
  'no lo dice. Un campo sin evidencia suficiente va en null. Di solo lo que se sabe: nunca hables de la evidencia, de lo que falta ni de lo que no',
  'se sabe («no hay evidencia…», «la evidencia no detalla…», «no se especifica…»).',
  '- «empresa»: qué hace la empresa y dónde opera, como lo diría alguien que la conoce.',
  '- «novedad»: la noticia que más sirve para abrir una conversación sobre lo que vende el vendedor (un proyecto, una expansión, una inversión, un',
  '  incidente, una fiscalización, un cambio de dueños o de plana). «n» es su número y «texto» dice qué pasó, sin la fecha ni el medio (se agregan',
  '  aparte). null si ninguna sirve, si son de otra empresa con nombre parecido o si no hay noticias.',
  '- «porque»: por qué lo que vende el vendedor le sirve a ESTA empresa, unido a algo de la evidencia (su operación, sus faenas, la novedad).',
  '- «cargo»: qué le importa a quien tiene ese cargo frente a lo que vende el vendedor: de qué responde y qué le quita el sueño. Empieza por el',
  '  verbo («Responde por…», «Decide…»), sin repetir el cargo.',
  '- «apertura»: cómo abrir la conversación, dicho al vendedor: «Pregúntale…» o «Coméntale…», con algo concreto de su operación o de la novedad.',
  '  No redactes el correo.',
  'Responde JSON conforme al contrato.',
].join('\n');

/**
 * The brief of one contact, and the company's site when it could be told. Null without a company to look for or without anything
 * found about it. Never throws.
 */
export async function researchDropContact(input: DropResearchInput, deps: DropResearchDeps): Promise<DropResearch | null> {
  const company = clip(input.contact.company, 160);
  const tokens = companyTokens(company);
  if (!company || !tokens.length) return null;
  const search = deps.search ?? ((request: Parameters<typeof searchSerper>[0]) => searchSerper(request));
  const home = deps.home ?? ((domain: string) => fetchCompanyHomePage(domain, { timeoutMs: 6_000 }));
  const place = { countryCode: countryCode(input.contact.country), language: 'es' };
  const named = searchName(company);
  const [organic, news] = await Promise.all([
    search({ organizationId: input.organizationId, kind: 'organic', query: `${named} empresa`, limit: 6, ...place }).then(result => result.items || []).catch(() => [] as SerperSearchItem[]),
    search({ organizationId: input.organizationId, kind: 'news', query: `"${named}"`, limit: 8, ...place }).then(result => result.items || []).catch(() => [] as SerperSearchItem[]),
  ]);
  const about = (item: SerperSearchItem) => mentionsCompany(`${item.title || ''} ${item.snippet || ''}`, tokens);
  const domain = clip(input.contact.domain, 253).toLowerCase() || companySite(company, organic);
  const page = domain ? await home(domain).catch(() => null) : null;
  const results = organic.filter(about).slice(0, 4).map(item => ({ titulo: clip(item.title, 160), extracto: clip(item.snippet, 320) }));
  const fresh = news.filter(about).flatMap(item => {
    const date = newsDate(item.date, deps.now);
    const url = clip(item.link, 500);
    if (!item.title || !/^https?:\/\//i.test(url) || (date && deps.now.getTime() - date.getTime() > NEWS_MAX_DAYS * 86_400_000)) return [];
    return [{ item, date, url }];
  }).slice(0, 5);
  if (!page && !results.length && !fresh.length) return null;

  const seller = input.seller && (input.seller.offer || input.seller.services?.length) ? {
    empresa: clip(input.seller.company, 120) || null, oferta: clip(input.seller.offer, 600) || null, servicios: (input.seller.services || []).slice(0, 8).map(value => clip(value, 160)),
    resultados: (input.seller.proofPoints || []).slice(0, 4).map(value => clip(value, 160)), rubro: clip(input.seller.sector, 120) || null,
  } : null;
  const prompt = JSON.stringify({
    vendedor: seller,
    contacto: { cargo: clip(input.contact.title, 160) || null, empresa: company, rubro: clip(input.contact.industry, 120) || null },
    sitio: page ? { titulo: clip(page.title, 200) || null, descripcion: clip(page.description, 400) || null, texto: clip(page.text, 1600) || null } : null,
    resultados: results,
    noticias: fresh.map(({ item, date }, n) => ({ n, titulo: clip(item.title, 200), extracto: clip(item.snippet, 320) || null, medio: clip(item.source, 80) || null, fecha: date ? dateLabel(date) : clip(item.date, 40) || null })),
  });
  const answer = await deps.generate({ schema: briefSchema, systemPrompt: BRIEF_PROMPT, prompt, openAiModel: modelOf(), reasoningEffort: 'low', maxOutputTokens: 900, timeoutMs: 30_000 }).catch(() => null);
  const parsed = answer ? briefSchema.safeParse(answer) : null;
  if (!parsed?.success) return null;
  // A figure that is not in the evidence is the model's, not a fact: that line is left out rather than shown.
  const grounded = (line: string) => (line.match(/\d+(?:[.,]\d+)*/g) || []).every(figure => prompt.includes(figure));
  // And what the model says of its own sources («…; no hay evidencia sobre dónde opera») is not for the person: that clause is left out.
  const line = (value: string | null, max: number) => { const said = clip(String(value || '').replace(/^[\s\-–•*·]+/, ''), max + 1); return said && said.length <= max && grounded(said) ? withoutSourceTalk(said) : null; };
  const chosen = parsed.data.novedad ? fresh[parsed.data.novedad.n] : null;
  const happened = chosen ? line(parsed.data.novedad!.texto, 280) : null;
  const brief: DropBrief = {
    company: line(parsed.data.empresa, 260),
    news: chosen && happened ? { text: happened, date: chosen.date ? dateLabel(chosen.date) : null, source: clip(chosen.item.source, 80) || null, url: chosen.url } : null,
    fit: seller ? line(parsed.data.porque, 280) : null,
    role: seller ? line(parsed.data.cargo, 260) : null,
    opener: seller ? line(parsed.data.apertura, 280) : null,
  };
  if (!brief.company && !brief.news && !brief.fit && !brief.role && !brief.opener) return null;
  return { brief, domain: domain || null };
}

/** «Adjudicó la ampliación del terminal (Diario Financiero, 3 nov 2026)»: the news of a brief as one line. */
export function briefNewsLine(news: NonNullable<DropBrief['news']>) {
  const where = [news.source, news.date].filter(Boolean).join(', ');
  return `${news.text.replace(/[.\s]+$/, '')}${where ? ` (${where})` : ''}.`;
}
