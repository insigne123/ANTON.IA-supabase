import { z } from 'zod';
import type { DropCriteria } from '@/lib/lead-drops';

/**
 * How much each contact of a drop is worth recommending, from 0 to 100, said before anything is written for it (18 Nov 2026, the
 * owner: «un módulo de IA que les asigne un porcentaje de recomendación y que haga volver a buscar si ese porcentaje es bajo para un
 * lead, de esa manera solo le entregamos leads buenos»).
 *
 * The finder's score (lead-drop-finder.ts) ranks hundreds of people by their title and their company's name, which is all Apollo's
 * free search says of them: it never knew what the company does, so a builder reached someone who sells to retail, and the owner of a
 * one-person firm reached someone who staffs warehouses. This judge reads each chosen contact after its research
 * (lead-drop-research.ts: what the company does, what is happening there) and answers for the person who will receive it:
 *
 * - `pct`: how likely it is that writing to this person is worth the seller's time, 0 to 100;
 * - `reason`: one sentence the seller can read;
 * - `industry`: what the company does in two or three words, which Apollo's search does not say.
 *
 * `writeDrop` replaces whoever stays under the minimum with the best of the next ones the finder kept in reserve (two reserves
 * researched and judged for each one that fell short), delivers only those who reach it, the best first, and remembers who did not
 * so the search does not bring them back. Best effort: without the model nobody is judged and the drop goes on as before.
 */

type Generate = (options: { schema: z.ZodTypeAny; systemPrompt: string; prompt: string; openAiModel?: string; reasoningEffort?: any;
  maxOutputTokens: number; timeoutMs: number }) => Promise<any>;

export type GateSeller = { company?: string | null; offer?: string | null; services?: string[] | null; sector?: string | null;
  /** The problems the profile says it solves, and «En tus palabras»: who the person and their team say they look for. */
  problems?: string[] | null; wants?: string | null; teamWants?: string | null };
export type GateContact = {
  leadId: string; title: string | null; company: string | null; industry?: string | null; size?: string | number | null; place?: string | null;
  /** «refer»: offered as someone who can say who decides, not as who decides. */
  role?: 'refer' | null;
  /** What the research read of the company and what is happening there now; nothing when it found nothing. */
  about?: string | null; news?: string | null;
};
export type GateVerdict = { pct: number; reason: string | null; industry: string | null };

/** Under this, a contact is replaced and, if nobody better is left, not delivered. 0 turns the replacing off: the percentage is only shown. */
export const DEFAULT_MIN_RECOMMENDATION = 60;
export function dropMinRecommendation(env: Record<string, string | undefined> = process.env) {
  const value = Number(env.LEAD_DROPS_MIN_RECOMMENDATION);
  return Number.isFinite(value) && value >= 0 && value <= 100 && String(env.LEAD_DROPS_MIN_RECOMMENDATION ?? '').trim() !== '' ? Math.round(value) : DEFAULT_MIN_RECOMMENDATION;
}
/** How many reserves are researched and judged for each contact that fell short: the best of them take the places. */
export const GATE_SPARES_PER_LOW = 2;
/**
 * The replacements are one more research and one more call to the model before anything is written: they are only looked for
 * while the drop is this young, so a slow night never leaves a drop half written when the run ends (cron/lead-drops, ROUND_MS).
 */
export const GATE_REPLACE_BEFORE_MS = 60_000;
/** How many people a drop remembers as not worth offering again (criteria.gate.rejected). */
export const GATE_REJECTED_MAX = 40;

const clip = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const modelOf = () => process.env.LEAD_DROPS_GATE_MODEL?.trim() || process.env.LEAD_DROPS_RESEARCH_MODEL?.trim() || 'claude-haiku-5-5';

const schema = z.object({
  contactos: z.array(z.object({ i: z.number().int().min(0), pct: z.number().min(0).max(100), razon: z.string().max(260).nullable().optional(),
    rubro: z.string().max(60).nullable().optional() }).strict()).max(20),
}).strict();

const PROMPT = [
  'Eres quien decide si un contacto vale el tiempo de un vendedor B2B. Recibes lo que vende (vendedor), a quién le vende (cliente_ideal) y una lista',
  'de contactos ya elegidos, cada uno con su cargo, su empresa y lo que una investigación leyó de esa empresa (que_hace, ahora). Por cada contacto',
  'responde «pct», de 0 a 100: qué tan probable es que escribirle a esa persona le sirva al vendedor para vender lo que vende.',
  '',
  'Cómo se arma el porcentaje:',
  '- La empresa (la mitad del peso): ¿necesita lo que vende el vendedor y es del tamaño y del tipo que busca? Una empresa de los rubros del cliente',
  '  ideal con operación propia suma mucho. Los rubros del cliente ideal son ejemplos de a quién le vende: una empresa de otro rubro con la misma',
  '  necesidad (la que resuelve la oferta) es un rubro vecino y suma algo menos, no es ajena. Una que no tiene que ver, una empresa de una sola',
  '  persona, un consultor o asesor independiente, un emprendimiento sin dotación, o una que vende lo mismo que el vendedor (competencia o proveedor',
  '  del mismo servicio) baja de 40 aunque el cargo calce.',
  '- La persona (la otra mitad): los cargos del cliente ideal son los que el vendedor dijo que le compran. Un cargo de esa lista, o el mismo dicho',
  '  con otras palabras, calza de lleno: no lo bajes porque a ti te parezca que esa compra la decide otra área. El mismo cargo a cargo de una sola',
  '  unidad (una bodega, una zona, una planta, una tienda) calza con una reserva menor. Un cargo de un área vecina, o más general (dueño, gerente',
  '  general de una empresa mediana), suma menos; alguien sin relación con esa compra, o un cargo sin mando (analista, asistente), baja de 40 aunque',
  '  la empresa calce. Si viene marcado «puede_derivar», júzgalo como puerta de entrada: vale si es del área y puede decir quién decide.',
  '- Lo que pasa ahora en la empresa («ahora») sube el porcentaje solo cuando toca lo que vende el vendedor.',
  '',
  'Si el vendedor escribió a quién busca («busca_en_sus_palabras», «su_equipo_busca»), eso manda sobre los rubros y cargos del cliente ideal: quien',
  'calza con lo que escribió sube, y quien cae en lo que dijo no querer baja de 40.',
  '',
  'Escala: 85 a 100, empresa y persona calzan de lleno; 70 a 84, calzan con una reserva menor; 60 a 69, vale el intento; 40 a 59, dudoso; bajo 40,',
  'no vale el tiempo. Usa toda la escala y no repartas la misma nota a todos.',
  '',
  'Cuando «que_hace» viene vacío, juzga a la empresa por su nombre y por lo que sepas de ella (una empresa grande y conocida se juzga por lo que',
  'es). Si no la conoces y su nombre no dice a qué se dedica, la empresa no suma ni resta y decide la persona: con un cargo del cliente ideal queda',
  'entre 60 y 72, con uno vecino entre 45 y 59, y la razón dice que falta confirmar a qué se dedica. No inventes hechos de la empresa.',
  '',
  '«razon»: una frase en español, de hasta 200 caracteres, que el vendedor pueda leer: por qué vale la pena o qué reserva tiene. Sin tecnicismos, sin',
  'la palabra «score» ni el porcentaje. «rubro»: a qué se dedica la empresa en dos o tres palabras («Retail», «Minería», «Logística y transporte»), o',
  'null si no se sabe. Responde JSON conforme al contrato, con el número (i) de cada contacto.',
].join('\n');

/**
 * A verdict for each contact the model answered for. Null when there is no model or its answer cannot be read: nobody was judged,
 * and the caller goes on as if this module did not exist. A contact it skipped has no verdict, and is kept.
 */
export async function judgeDropContacts(input: {
  contacts: GateContact[]; criteria: DropCriteria | null; seller: GateSeller | null; generate?: Generate;
}): Promise<Map<string, GateVerdict> | null> {
  const contacts = input.contacts.filter(contact => contact.leadId && (contact.title || contact.company)).slice(0, 20);
  if (!input.generate || !contacts.length) return null;
  const criteria = input.criteria;
  const prompt = JSON.stringify({
    vendedor: input.seller ? { empresa: clip(input.seller.company, 120) || null, oferta: clip(input.seller.offer, 600) || null,
      servicios: (input.seller.services || []).slice(0, 8).map(value => clip(value, 120)), rubro: clip(input.seller.sector, 120) || null,
      ...((input.seller.problems || []).length ? { problemas_que_resuelve: input.seller.problems!.slice(0, 6).map(value => clip(value, 160)) } : {}),
      ...(clip(input.seller.wants, 600) ? { busca_en_sus_palabras: clip(input.seller.wants, 600) } : {}),
      ...(clip(input.seller.teamWants, 600) ? { su_equipo_busca: clip(input.seller.teamWants, 600) } : {}) } : null,
    cliente_ideal: criteria ? { cargos: criteria.titles || [], rubros: criteria.industries || [], lugares: criteria.locations || [],
      // «51,200» is how the search keeps a range of employees: said so it is not read as a number.
      empleados: (criteria.sizes || []).map(size => String(size).replace(/\s*[,-]\s*/, ' a ')) } : null,
    contactos: contacts.map((contact, i) => ({
      i, cargo: clip(contact.title, 160) || null, empresa: clip(contact.company, 200) || null, rubro_segun_busqueda: clip(contact.industry, 120) || null,
      empleados: contact.size ?? null, lugar: clip(contact.place, 120) || null, ...(contact.role === 'refer' ? { puede_derivar: true } : {}),
      que_hace: clip(contact.about, 400) || null, ahora: clip(contact.news, 300) || null,
    })),
  });
  const answer = await input.generate({ schema, systemPrompt: PROMPT, prompt, openAiModel: modelOf(), reasoningEffort: 'low',
    maxOutputTokens: 500 + contacts.length * 110, timeoutMs: 20_000 }).catch(() => null);
  const parsed = answer ? schema.safeParse(answer) : null;
  if (!parsed?.success) return null;
  const verdicts = new Map<string, GateVerdict>();
  for (const entry of parsed.data.contactos) {
    const contact = contacts[entry.i];
    if (!contact || verdicts.has(contact.leadId)) continue;
    verdicts.set(contact.leadId, { pct: Math.max(0, Math.min(100, Math.round(entry.pct))), reason: clip(entry.razon, 220) || null, industry: clip(entry.rubro, 60) || null });
  }
  return verdicts;
}
