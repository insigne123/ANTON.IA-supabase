import { z } from 'zod';
import type { DropCandidate, DropCriteria, DropItem, DropScore } from '@/lib/lead-drops';
import { classifyTitles, matchOf, titleSearchTerms, type TitleAiDeps } from '@/lib/server/search/title-ai';

/**
 * The finder of «Contacto del día» for teams that get several contacts a day (12 Nov 2026, docs/contacto-del-dia.md). The one-contact
 * drop takes the first person whose title has the words of the customer's; with six a day that runs out of good people in a week
 * and never learns. So, with Apollo's free search and a small model (Claude Haiku):
 *
 * 1. the search is asked more ways: the customer's roles as people write them and the words of their area (title-ai.ts);
 * 2. every candidate's title is classified against the customer's roles (exact, similar, related, none);
 * 3. each one is scored on what the search says: whether that role decides or influences buying what the team sells, and whether
 *    that company is one that would need it, with what the team kept or refused before as examples;
 * 4. the picker (pickRankedDrops) takes the best of the customer's own roles and keeps some slots for roles next to them.
 *
 * Everything here is best effort: a model that fails leaves the classes and a local score, and the drop is made as before.
 */

type Generate = (options: { schema: z.ZodTypeAny; systemPrompt: string; prompt: string; openAiModel?: string; reasoningEffort?: any;
  maxOutputTokens: number; timeoutMs: number }) => Promise<any>;

export type FinderSeller = { company?: string | null; offer?: string | null; services?: string[] | null; differentiators?: string[] | null; sector?: string | null };
/** What the team did with earlier contacts: «Jefe de Prevención de Riesgos · Minería», each at most once, the most repeated first. */
export type FinderLessons = { liked: string[]; disliked: string[] };

const SCORE_CHUNK = 40;
const MAX_SCORED = 120;
// A score is the class of the title plus the two notes: 20 + 10 × 4.5 + 10 × 3.5 = 100 at most.
const CLASS_BASE: Record<DropScore['titleClass'], number> = { exact: 20, similar: 16, related: 8 };
const ROLE_WEIGHT = 4.5;
const COMPANY_WEIGHT = 3.5;
/** A note of the role or of the company this low or lower leaves the person out, whatever the words of the title. */
const TOO_LOW = 2;
/** What a candidate the model did not score gets for its notes: the middle of the scale. */
const MIDDLE = 5;
const scoreOf = (titleClass: DropScore['titleClass'], role: number, company: number, hasPhone: boolean) =>
  Math.round(CLASS_BASE[titleClass] + role * ROLE_WEIGHT + company * COMPANY_WEIGHT + (hasPhone ? 1 : 0));
const clip = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const modelOf = () => process.env.LEAD_DROPS_FINDER_MODEL?.trim() || process.env.LEAD_DROPS_RESEARCH_MODEL?.trim() || 'claude-haiku-5-5';
const titleDeps = (generate?: Generate): TitleAiDeps => (generate ? { generate: (options => generate(options as never)) as TitleAiDeps['generate'] } : {});

/** The customer's roles as people write them and the words of their area, for the extra searches. Without the model, the roles alone. */
export async function finderSearchTerms(criteria: DropCriteria, generate?: Generate): Promise<{ titles: string[]; keywords: string[] }> {
  const asked = criteria.titles.filter(Boolean);
  if (!asked.length) return { titles: [], keywords: [] };
  const terms = await titleSearchTerms(asked, titleDeps(generate)).catch(() => ({ titles: asked, keywords: [] as string[] }));
  const known = new Set(asked.map(title => title.toLowerCase()));
  return { titles: terms.titles.filter(title => !known.has(title.toLowerCase())), keywords: terms.keywords };
}

const scoreSchema = z.object({
  people: z.array(z.object({ i: z.number().int().min(0), cargo: z.number().int().min(0).max(10), empresa: z.number().int().min(0).max(10) }).strict()).max(SCORE_CHUNK),
}).strict();

const SCORE_PROMPT = [
  'Ayudas a un vendedor B2B a elegir a quién contactar. Recibes lo que vende (vendedor), a quién le vende (cliente_ideal), lo que su equipo hizo con',
  'contactos anteriores (aprendizaje) y una lista de personas encontradas. Por cada persona entrega dos notas de 0 a 10. Usa toda la escala: la lista',
  'se ordena con tus notas, así que dos personas distintas rara vez merecen la misma.',
  '',
  '«cargo»: cuánto decide esa persona la compra de lo que vende el vendedor.',
  '- 9 o 10: es dueña directa del problema que eso resuelve: lo sufre, lo tiene entre sus responsabilidades y decide o pide la compra.',
  '- 7 u 8: lo decide o lo aprueba, pero su cargo es más general (gerencia general, de operaciones o de planta) o más junior que quien decide.',
  '- 4 a 6: influye en la compra o usa el servicio, sin decidir.',
  '- 1 a 3: apenas tiene que ver.',
  '- 0: nada que ver.',
  'Lee el cargo completo y juzga la función real, no las palabras que comparte con los cargos del cliente ideal: una palabra que lo lleva a otra',
  'área («Financieras», «TI», «Comercial», «Marketing», «Personas», una marca o una línea de producto ajena) cambia la función, y entonces la nota es',
  'la de esa función. Un cargo de staff sin relación con lo que se vende es 0 o 1 aunque la empresa sea ideal.',
  '',
  '«empresa»: cuánto necesitaría esa empresa lo que vende, por su rubro, su tamaño, su lugar y su descripción. Si solo viene el nombre, usa lo que',
  'sabes de esa empresa.',
  '- 9 o 10: es del rubro objetivo y tiene la operación que necesita lo que se vende.',
  '- 6 a 8: rubro vecino o necesidad plausible.',
  '- 3 a 5: no la conoces o faltan datos para decirlo.',
  '- 1 o 2: improbable.',
  '- 0: no calza: otro país, competidor del vendedor o un rubro sin relación.',
  '',
  'Usa el aprendizaje: sube a quienes se parecen a los que le sirvieron y baja a quienes se parecen a los que descartó, sobre todo por el motivo que',
  'dio. Sin explicaciones. Responde JSON conforme al contrato, con el número (i) de cada persona.',
].join('\n');

/**
 * A score for each candidate worth offering (keyed by its id): the class of its title against the customer's roles and, from the
 * model, how much that role decides the purchase and how much that company would need it. A title that has nothing to do with the
 * customer's roles gets no score, so it is never offered, and neither does one the model gives a note of TOO_LOW or less (a «Gerente de
 * Operaciones Financieras» for a team that sells to the plant's operations). With the model failing, the class and the middle of the scale.
 */
export async function scoreDropCandidates(input: {
  candidates: DropCandidate[]; criteria: DropCriteria; seller: FinderSeller | null; lessons?: FinderLessons; generate?: Generate;
}): Promise<Map<string, DropScore>> {
  const scores = new Map<string, DropScore>();
  const asked = input.criteria.titles.filter(Boolean);
  if (!asked.length || !input.candidates.length) return scores;
  const classes = await classifyTitles(asked, input.candidates.map(candidate => String(candidate.title || '')), titleDeps(input.generate));
  const classed = input.candidates.flatMap(candidate => {
    const titleClass = matchOf(classes, candidate.title);
    return titleClass === 'none' ? [] : [{ candidate, titleClass }];
  });
  // The model reads the closest ones first, and at most MAX_SCORED: the rest keep the class alone.
  const order = { exact: 0, similar: 1, related: 2 } as const;
  classed.sort((a, b) => order[a.titleClass] - order[b.titleClass] || Number(b.candidate.hasPhone) - Number(a.candidate.hasPhone));
  for (const { candidate, titleClass } of classed) scores.set(candidate.leadId, { titleClass, score: scoreOf(titleClass, MIDDLE, MIDDLE, candidate.hasPhone) });

  const generate = input.generate;
  const toScore = classed.slice(0, MAX_SCORED);
  if (!generate || !toScore.length) return scores;
  const chunks = Array.from({ length: Math.ceil(toScore.length / SCORE_CHUNK) }, (_, index) => toScore.slice(index * SCORE_CHUNK, (index + 1) * SCORE_CHUNK));
  const context = {
    vendedor: input.seller ? {
      empresa: clip(input.seller.company, 120) || null, oferta: clip(input.seller.offer, 600) || null,
      servicios: (input.seller.services || []).slice(0, 8).map(value => clip(value, 120)), diferenciadores: (input.seller.differentiators || []).slice(0, 5).map(value => clip(value, 160)),
      rubro: clip(input.seller.sector, 120) || null,
    } : null,
    cliente_ideal: { cargos: input.criteria.titles, rubros: input.criteria.industries, lugares: input.criteria.locations, tamanos: input.criteria.sizes },
    aprendizaje: { le_sirvieron: (input.lessons?.liked || []).slice(0, 10), descarto: (input.lessons?.disliked || []).slice(0, 10) },
  };
  await Promise.all(chunks.map(async chunk => {
    const answer = await generate({
      schema: scoreSchema, systemPrompt: SCORE_PROMPT, openAiModel: modelOf(), reasoningEffort: 'low', maxOutputTokens: 600 + chunk.length * 40, timeoutMs: 40_000,
      prompt: JSON.stringify({ ...context, personas: chunk.map(({ candidate }, i) => ({
        i, cargo: candidate.title, nivel: candidate.seniority || null, area: candidate.department || null, empresa: candidate.company, rubro: candidate.industry,
        empleados: candidate.size, lugar: [candidate.city, candidate.country].filter(Boolean).join(', ') || null, descripcion: clip(candidate.about, 240) || null,
      })) }),
    }).catch(() => null);
    const parsed = answer ? scoreSchema.safeParse(answer) : null;
    for (const entry of parsed?.success ? parsed.data.people : []) {
      const target = chunk[entry.i];
      if (!target) continue;
      // Someone the model says has little to do (the role or the company) is not offered, whatever the class of the title.
      if (entry.cargo <= TOO_LOW || entry.empresa <= TOO_LOW) { scores.delete(target.candidate.leadId); continue; }
      scores.set(target.candidate.leadId, { titleClass: target.titleClass, score: scoreOf(target.titleClass, entry.cargo, entry.empresa, target.candidate.hasPhone) });
    }
  }));
  return scores;
}

/**
 * What the team did with the contacts of earlier drops, as examples for the score: the ones a person saved or marked useful, and
 * the ones marked not useful (with the reason they gave). Each as «cargo · rubro», the most repeated first.
 */
export function dropLessons(rows: Array<{ items?: unknown }>): FinderLessons {
  const liked = new Map<string, number>(), disliked = new Map<string, number>();
  for (const row of rows) {
    for (const item of (Array.isArray(row.items) ? row.items : []) as DropItem[]) {
      const label = [clip(item?.title, 80), clip(item?.industry, 60)].filter(Boolean).join(' · ');
      if (!label) continue;
      if (item.feedback?.useful === false) {
        const reason = clip(item.feedback.reason, 80);
        const key = reason ? `${label} (${reason})` : label;
        disliked.set(key, (disliked.get(key) || 0) + 1);
      } else if (item.feedback?.useful === true || item.savedLeadId || item.keptLeadId) {
        liked.set(label, (liked.get(label) || 0) + 1);
      }
    }
  }
  const top = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')).slice(0, 10).map(([label]) => label);
  return { liked: top(liked), disliked: top(disliked) };
}
