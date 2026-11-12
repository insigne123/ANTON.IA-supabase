import { z } from 'zod';
import { generateStructured } from '@/ai/openai-json';

/**
 * Titles found by what they mean, not by how they are written. Apollo matches a title as consecutive words written exactly so, accents and
 * plurals included: on 12 Nov 2026, at a company where «Coordinador Gestión Riesgo Incendios» works, «coordinador de gestión de riesgo en
 * incendio», «coordinador gestion riesgo incendio», «coordinador incendios» and «gestion riesgo» found nobody, while «incendios», «riesgo
 * incendios» and «riesgo»/«riesgos» found him. Its «similar titles» are synonyms of common titles, not another wording of a rare one.
 *
 * So, with a small model (Claude Haiku) and a local rule when it fails:
 * - the asked title said the ways people write it (variants) and the words of its area as people write them (keywords, «riesgo»,
 *   «riesgos», «incendios»), which Apollo can match;
 * - every title that comes back classified against the asked one: «Cargo exacto», «Cargo similar», «Cargo relacionado» (who can decide or
 *   influence the same purchase), or nothing to do with it.
 */

export type TitleMatch = 'exact' | 'similar' | 'related' | 'none';
export type ShownTitleMatch = Exclude<TitleMatch, 'none'>;

export const TITLE_MATCH_LABEL: Record<ShownTitleMatch, string> = {
  exact: 'Cargo exacto',
  similar: 'Cargo similar',
  related: 'Cargo relacionado',
};

export { ALL_SEARCH_RESULTS } from '@/lib/search/limits';
/** Titles Apollo takes in one search (the gateway's MAX_FILTER_ITEMS): the asked ones first, then their variants; the same for keywords. */
export const MAX_SEARCH_TITLES = 20;
/** Titles per classification call: one call reads a company of a few hundred people. */
const CLASSIFY_CHUNK = 200;
const CACHE_MS = 24 * 60 * 60 * 1_000;
const CACHE_ENTRIES = 2_000;

type Generate = (options: Parameters<typeof generateStructured>[0]) => Promise<unknown>;
export type TitleAiDeps = { generate?: Generate; model?: string };

const modelOf = (deps: TitleAiDeps) => deps.model || process.env.SEARCH_TITLES_AI_MODEL?.trim() || 'claude-haiku-5-5';

const fold = (value: unknown) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'en', 'y', 'e', 'o', 'u', 'a', 'al', 'para', 'por', 'con', 'of', 'the', 'and', 'for', 'in', 'at', 'to', 'on']);
/**
 * A word without its plural and its final vowel, so the forms of one word are one: «jefe», «jefa» and «jefes»; «riesgo» and «riesgos»;
 * «líder» and «líderes»; «operación» and «operaciones». Words of three letters or fewer stay as they are («hse», «red»).
 */
const stem = (word: string) => {
  const singular = word.length > 3 ? word.replace(/s$/, '') : word;
  return singular.length > 3 ? singular.replace(/[aeo]$/, '') : singular;
};

export function titleWords(value: unknown): string[] {
  return fold(value).split(' ').filter((word) => word && !STOP.has(word)).map(stem);
}

/**
 * Without the model: a title with every word of an asked one (by its stem) is that title; one with most of them, a similar one. It is what
 * the classification falls back on, and it can only raise what the model said, never lower it.
 */
export function localTitleMatch(asked: string[], title: string): TitleMatch {
  const have = new Set(titleWords(title));
  if (!have.size) return 'none';
  let best: TitleMatch = 'none';
  for (const value of asked) {
    const words = [...new Set(titleWords(value))];
    if (!words.length) continue;
    const hits = words.filter((word) => have.has(word)).length;
    if (hits === words.length) return 'exact';
    if (words.length >= 2 && hits / words.length >= 0.6) best = 'similar';
  }
  return best;
}

const RANK: Record<TitleMatch, number> = { exact: 3, similar: 2, related: 1, none: 0 };
export const strongerMatch = (left: TitleMatch, right: TitleMatch): TitleMatch => (RANK[left] >= RANK[right] ? left : right);

// A small cache per server instance: the same title asked again (the next page, another company) costs nothing.
const termsCache = new Map<string, { at: number; variants: string[]; keywords: string[] }>();
const classesCache = new Map<string, { at: number; match: TitleMatch }>();
function remember<T>(cache: Map<string, { at: number } & T>, key: string, value: { at: number } & T) {
  if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, value);
}
const fresh = (at: number) => Date.now() - at < CACHE_MS;
export function clearTitleAiCache() {
  termsCache.clear();
  classesCache.clear();
}

/** Words of a title that say the role's level or kind, not its area: a search by them alone would bring half the company. */
const GENERIC = new Set(['gerente', 'gerenta', 'subgerente', 'jefe', 'jefa', 'subjefe', 'jefatura', 'coordinador', 'coordinadora', 'coordinacion',
  'encargado', 'encargada', 'director', 'directora', 'subdirector', 'subdirectora', 'supervisor', 'supervisora', 'analista', 'ingeniero',
  'ingeniera', 'especialista', 'asistente', 'administrador', 'administradora', 'ejecutivo', 'ejecutiva', 'lider', 'responsable', 'profesional',
  'tecnico', 'tecnica', 'operador', 'operadora', 'superintendente', 'presidente', 'vicepresidente', 'gestion', 'general', 'corporativo',
  'corporativa', 'nacional', 'regional', 'zonal', 'area', 'departamento', 'equipo', 'senior', 'junior', 'sr', 'jr', 'gte', 'sub', 'head',
  'manager', 'lead', 'chief', 'officer', 'director', 'coordinator', 'supervisor', 'specialist', 'analyst', 'engineer', 'assistant',
  'executive', 'vp', 'vice', 'president', 'principal', 'team', 'global', 'country']);

const deaccent = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');

/** The singular of a word written in plural, when it can be told: «riesgos» → «riesgo», «operaciones» → «operación», «líderes» → «líder». */
function singularOf(word: string): string | null {
  if (word.length <= 3 || !word.endsWith('s') || /[iu]s$/.test(word)) return null;
  if (/ones$/.test(word)) return `${word.slice(0, -4)}ón`;
  if (/[lnrdjy]es$/.test(word)) return word.slice(0, -2);
  return word.slice(0, -1);
}

/** The plural of a word written in singular: «incendio» → «incendios», «operación» → «operaciones», «líder» → «líderes». */
function pluralOf(word: string): string | null {
  if (word.endsWith('s')) return null;
  if (/ón$/.test(word)) return `${word.slice(0, -2)}ones`;
  if (/[aeiouáéíóú]$/.test(word)) return `${word}s`;
  return `${word}es`;
}

/** The written forms of one word, as Apollo needs them: singular and plural, with and without accents (an acronym, as it is). */
function wordForms(word: string, acronym = false): string[] {
  const forms = new Set<string>([word]);
  const other = acronym || word.length <= 3 ? null : singularOf(word) ?? pluralOf(word);
  if (other) forms.add(other);
  for (const form of [...forms]) forms.add(deaccent(form));
  return [...forms];
}

/** Without the model: the words of the asked titles that say their area, in their written forms. */
export function localKeywords(titles: string[]): string[] {
  const out = new Map<string, string>();
  for (const title of titles) {
    for (const written of String(title || '').split(/[^\p{L}\p{N}]+/u)) {
      const word = written.toLowerCase();
      if (word.length < 3 || STOP.has(fold(word)) || GENERIC.has(fold(word))) continue;
      for (const form of wordForms(word, /^[A-Z0-9]{2,}$/.test(written))) if (!out.has(form)) out.set(form, form);
    }
  }
  return [...out.values()].slice(0, MAX_SEARCH_TITLES);
}

const termsSchema = z.object({
  titles: z.array(z.object({
    i: z.number().int().min(0),
    variants: z.array(z.string().max(120)).max(14),
    keywords: z.array(z.string().max(60)).max(12),
  }).strict()).max(10),
}).strict();

const TERMS_PROMPT = 'Eres experto en cómo se escriben los cargos en LinkedIn en Chile y Latinoamérica. Por cada cargo pedido (corrige errores de '
  + 'tipeo) responde, con su número (i), dos listas. «variants»: hasta 12 formas en que las personas escriben ESE MISMO cargo en su perfil: con y sin '
  + '«de», «en» o «del»; en singular y en plural; con tildes y sin tildes; abreviado («Gte.», «Jefe», «Jefa», «Encargado», «Head of», «Lead»); en '
  + 'inglés si en Chile se usa; y con el área escrita de otra forma («Gestión Riesgo Incendios», «Prevención de Incendios»). Mismo rol y nivel '
  + 'parecido: no agregues otros roles ni niveles muy distintos (un analista no es un gerente). «keywords»: hasta 8 palabras sueltas o frases de dos '
  + 'palabras que nombran el ÁREA del cargo y que tendría en su título quien hace ese trabajo, de la más propia de ese cargo a la más general, cada '
  + 'una en singular y en plural y con y sin tildes («incendio», «incendios», «riesgo», «riesgos», «prevención», «prevencion»); nunca palabras de '
  + 'nivel o de tipo de cargo (gerente, jefe, coordinador, encargado, analista, manager, head, gestión). Sin explicaciones. Responde JSON conforme '
  + 'al contrato.';

const cleanTerms = (values: string[], max: number) => values.map((value) => value.replace(/\s+/g, ' ').trim()).filter((value) => value.length >= 2).slice(0, max);

/**
 * What a title search sends to Apollo: the asked titles and the ways people write them (`titles`), and the words of their area as people write
 * them (`keywords`), each at most MAX_SEARCH_TITLES, taken in turns so every asked title has its share. One model call for the titles not
 * seen in a day; without the model, the asked titles and the local keywords.
 */
export async function titleSearchTerms(titles: string[], deps: TitleAiDeps = {}): Promise<{ titles: string[]; keywords: string[] }> {
  const asked = [...new Map(titles.map((title) => [fold(title), String(title || '').trim()] as const).filter(([key]) => key)).values()].slice(0, 10);
  if (!asked.length) return { titles: [], keywords: [] };
  const terms = asked.map((title) => {
    const cached = termsCache.get(fold(title));
    return cached && fresh(cached.at) ? { variants: cached.variants, keywords: cached.keywords, known: true } : { variants: [] as string[], keywords: [] as string[], known: false };
  });
  const missing = asked.map((title, index) => ({ title, index })).filter(({ index }) => !terms[index].known);
  if (missing.length) {
    const generate = deps.generate || (generateStructured as Generate);
    const answer = await generate({
      schema: termsSchema, systemPrompt: TERMS_PROMPT, prompt: JSON.stringify({ cargos: missing.map(({ title }, i) => ({ i, cargo: title })) }),
      openAiModel: modelOf(deps), allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: 2_400, timeoutMs: 15_000, reasoningEffort: 'low',
    }).catch(() => null);
    const parsed = answer ? termsSchema.safeParse(answer) : null;
    for (const entry of parsed?.success ? parsed.data.titles : []) {
      const target = missing[entry.i];
      if (!target || terms[target.index].known) continue;
      const variants = cleanTerms(entry.variants, 14);
      const keywords = cleanTerms(entry.keywords, 12).filter((value) => !GENERIC.has(fold(value)));
      terms[target.index] = { variants, keywords, known: true };
      remember(termsCache, fold(target.title), { at: Date.now(), variants, keywords });
    }
    // A title the model did not answer keeps the words it has.
    for (const { title, index } of missing) if (!terms[index].known) terms[index] = { variants: [], keywords: localKeywords([title]), known: false };
  }
  // In turns: the first of each title, then the second of each, so three asked titles share the twenty.
  const inTurns = (lists: string[][], seed: string[], key: (value: string) => string) => {
    const out = new Map<string, string>();
    for (const value of seed) if (key(value) && !out.has(key(value))) out.set(key(value), value);
    for (let i = 0; out.size < MAX_SEARCH_TITLES && lists.some((list) => i < list.length); i++) {
      for (const list of lists) if (list[i] && key(list[i]) && !out.has(key(list[i])) && out.size < MAX_SEARCH_TITLES) out.set(key(list[i]), list[i]);
    }
    return [...out.values()].slice(0, MAX_SEARCH_TITLES);
  };
  return {
    titles: inTurns(terms.map((term) => term.variants), asked, fold),
    // Apollo tells «Gestión» from «gestion»: the keywords keep both forms, keyed as written.
    keywords: inTurns(terms.map((term) => term.keywords), [], (value) => value.toLowerCase()),
  };
}

/** The asked titles and the ways people write them, for a search by filters (Apollo takes any of them). Without the model, the asked ones. */
export async function expandTitleVariants(titles: string[], deps: TitleAiDeps = {}): Promise<string[]> {
  return (await titleSearchTerms(titles, deps)).titles;
}

const classesSchema = z.object({
  titles: z.array(z.object({ i: z.number().int().min(0), match: z.enum(['exact', 'similar', 'related', 'none']) }).strict()).max(CLASSIFY_CHUNK),
}).strict();

const CLASSIFY_PROMPT = 'Clasificas cargos de LinkedIn contra el cargo que busca un vendedor. Para cada cargo numerado responde: '
  + '«exact» si es el mismo cargo aunque esté escrito distinto (otras palabras, sin preposiciones, plural, abreviado, en inglés); '
  + '«similar» si es la misma función con un nivel o un alcance parecido (Jefe de Prevención de Riesgos para Coordinador de Gestión de Riesgos); '
  + '«related» si es una función vecina que suele decidir o influir en la misma compra (su jefatura, el área hermana); '
  + '«none» si no tiene relación. Ante la duda entre dos, la más baja. Responde JSON conforme al contrato, con el número (i) de cada cargo.';

/**
 * Each title against the asked ones (exact, similar, related or none), keyed by the title as folded. The model reads the distinct titles in
 * chunks; the local rule raises what it says when every asked word is there. When the model fails, the local rule alone.
 */
export async function classifyTitles(asked: string[], titles: string[], deps: TitleAiDeps = {}): Promise<Map<string, TitleMatch>> {
  const askedKey = asked.map(fold).filter(Boolean).sort().join('|');
  const result = new Map<string, TitleMatch>();
  const distinct = [...new Map(titles.map((title) => [fold(title), String(title || '').trim()] as const).filter(([key]) => key)).entries()];
  const pending: Array<[string, string]> = [];
  for (const [key, title] of distinct) {
    const cached = classesCache.get(`${askedKey}::${key}`);
    if (cached && fresh(cached.at)) result.set(key, cached.match);
    else pending.push([key, title]);
  }
  const generate = deps.generate || (generateStructured as Generate);
  // The chunks at once: a company of a thousand titles takes as long as one of two hundred.
  const chunks = Array.from({ length: Math.ceil(pending.length / CLASSIFY_CHUNK) }, (_, index) => pending.slice(index * CLASSIFY_CHUNK, (index + 1) * CLASSIFY_CHUNK));
  await Promise.all(chunks.map(async (chunk) => {
    const answer = await generate({
      schema: classesSchema, systemPrompt: CLASSIFY_PROMPT, openAiModel: modelOf(deps), allowDefaultModelFallback: false, maxAttempts: 1,
      prompt: JSON.stringify({ cargoBuscado: asked, cargos: chunk.map(([, title], i) => ({ i, cargo: title })) }),
      maxOutputTokens: Math.min(8_000, 400 + chunk.length * 24), timeoutMs: 25_000, reasoningEffort: 'low',
    }).catch(() => null) as z.infer<typeof classesSchema> | null;
    const parsed = answer ? classesSchema.safeParse(answer) : null;
    const said = new Map<number, TitleMatch>((parsed?.success ? parsed.data.titles : []).map((entry) => [entry.i, entry.match]));
    chunk.forEach(([key, title], i) => {
      const match = strongerMatch(said.get(i) ?? 'none', localTitleMatch(asked, title));
      result.set(key, match);
      // Only what the model answered is remembered: a chunk it failed is asked again next time.
      if (said.has(i)) remember(classesCache, `${askedKey}::${key}`, { at: Date.now(), match });
    });
  }));
  return result;
}

/** The match of one title in a classification (by the title as folded). */
export const matchOf = (classes: Map<string, TitleMatch>, title: unknown): TitleMatch => classes.get(fold(title)) ?? 'none';

/**
 * People kept and ordered by how their title matches: exact first, then similar, then related, each in the order they came; nobody whose
 * title has nothing to do with the asked one. Each carries its class (`title_match`), which the list shows.
 */
export function rankByTitle<T extends { title?: unknown }>(people: T[], classes: Map<string, TitleMatch>): Array<T & { title_match: ShownTitleMatch }> {
  const kept = people.map((person, index) => ({ person, index, match: matchOf(classes, person.title) }))
    .filter((entry): entry is { person: T; index: number; match: ShownTitleMatch } => entry.match !== 'none');
  kept.sort((left, right) => RANK[right.match] - RANK[left.match] || left.index - right.index);
  return kept.map(({ person, match }) => ({ ...person, title_match: match }));
}
