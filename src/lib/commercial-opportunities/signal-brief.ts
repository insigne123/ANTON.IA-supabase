// The structured part of a commercial sheet that the AI writes for a signal (a company that is hiring, a LinkedIn post): why now, how the
// signal fits the company's offer, who to contact, the angle, the messages by channel, a follow-up cadence and the objections to expect.
// Structured so the page and the PDF can draw it (cards, a timeline) instead of reading a wall of prose. A model that answers badly here
// must not sink a paid report: `sanitizeBrief` keeps what is usable and drops the rest. Pure.
import { z } from 'zod';

export const BRIEF_CHANNELS = ['linkedin', 'email', 'call'] as const;
export const CADENCE_CHANNELS = ['linkedin', 'email', 'call', 'research'] as const;
export const CHANNEL_LABELS: Record<string, string> = { linkedin: 'LinkedIn', email: 'Correo', call: 'Llamada', research: 'Investigación' };
export const STRENGTH_LABELS = { strong: 'Calza muy bien', medium: 'Calza en parte', weak: 'Calza poco' } as const;

const s = (max: number) => z.string().max(max);
export const commercialBriefSchema = z.object({
  /** The play in one line. */
  headline: s(160),
  /** Why now: up to four reasons, each resting on a number or a date of the signal. */
  whyNow: z.array(s(200)).max(4),
  fit: z.object({
    services: z.array(z.object({ service: s(120), why: s(260), strength: z.enum(['strong', 'medium', 'weak']) })).max(5),
    gaps: z.array(s(240)).max(4),
  }),
  company: z.object({ summary: s(500), facts: z.array(z.object({ label: s(40), value: s(160) })).max(8) }),
  buyers: z.array(z.object({ title: s(120), why: s(240), priority: z.enum(['primary', 'secondary']) })).max(6),
  approach: z.object({ angle: s(420), hooks: z.array(s(200)).max(4), avoid: z.array(s(200)).max(3) }),
  messages: z.array(z.object({ channel: z.enum(BRIEF_CHANNELS), subject: s(120), body: s(900) })).max(3),
  cadence: z.array(z.object({ day: z.number().int().min(0).max(45), channel: z.enum(CADENCE_CHANNELS), action: s(200) })).max(7),
  objections: z.array(z.object({ objection: s(200), answer: s(360) })).max(4),
});
export type CommercialBrief = z.infer<typeof commercialBriefSchema>;

/** What the writer is told about it; the model reads the schema too, this is what the schema cannot say. */
export const SIGNAL_BRIEF_RULE = [
  'commercial (el plan comercial, estructurado: la pantalla y el PDF lo dibujan como tarjetas y una línea de tiempo, así que cada campo es corto y concreto):',
  'headline: la jugada en una frase (qué se le ofrece a quién, y por qué ahora), sin adjetivos.',
  'whyNow: de 2 a 4 razones, cada una apoyada en una cifra o una fecha de la señal (avisos, semana, cargos, regiones, fecha de la publicación). Nada que no esté en los datos.',
  'fit.services: de 1 a 4 servicios de la empresa que calzan con la señal, cada uno con el motivo en una frase y strength (strong, medium o weak) según cuánto calza el cargo o la necesidad con ese servicio; no inventes servicios que la empresa no ofrece. fit.gaps: lo que la empresa tendría que respaldar o no sabe todavía.',
  'company.summary: lo que se sabe de la empresa en 2 o 3 frases, solo de los datos y las páginas leídas. company.facts: de 3 a 6 pares etiqueta y valor (rubro, tamaño, presencia, relación contigo); si un dato no viene, el valor es «No informado», nunca una cifra inventada.',
  'buyers: de 3 a 5 cargos de decisión o influencia para esta oferta (no nombres de personas), cada uno con por qué es relevante y priority primary o secondary; primary solo para uno o dos.',
  'approach.angle: el ángulo de la conversación en 2 o 3 frases. approach.hooks: de 2 a 4 datos concretos de la señal que conviene mencionar. approach.avoid: de 1 a 3 cosas que no hay que prometer ni decir (precios, cobertura, plazos sin validar).',
  'messages: un mensaje por canal, hasta tres. linkedin: nota de conexión de 280 caracteres como máximo, sin saludo largo. email: asunto (subject) y cuerpo de hasta 120 palabras. call: guion de apertura de 30 segundos (subject vacío). Cada uno menciona la señal concreta y termina con una sola pregunta o pedido. Usa [nombre] y [tu nombre] donde falten; no inventes datos de la persona.',
  'cadence: de 4 a 7 pasos para 3 semanas, ordenados por day (0 es hoy), cada uno con channel (linkedin, email, call o research) y la acción en una frase. Es una propuesta, no un compromiso.',
  'objections: de 2 a 4 objeciones probables con la respuesta que da la empresa sin prometer precio, cobertura ni plazos que no estén respaldados.',
].join('\n');

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** The usable entries, at most `max`: an empty one does not take the place of a good one (only the first dozen are looked at). */
const list = (value: unknown, max: number, each: (item: any) => unknown) => (Array.isArray(value) ? value.slice(0, max * 3).map(each).filter(Boolean).slice(0, max) : []);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

/**
 * What the model gave for `commercial`, cut to the schema's limits: texts clipped and tidied, entries without their key text left out,
 * unknown channels or strengths mapped to the safest one. Returns undefined when nothing usable is left, so a report is never lost to it.
 */
export function sanitizeBrief(value: unknown): CommercialBrief | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, any>;
  const brief: CommercialBrief = {
    headline: text(raw.headline, 160),
    whyNow: list(raw.whyNow, 4, item => text(item, 200)) as string[],
    fit: {
      services: list(raw.fit?.services, 5, item => (text(item?.service, 120) ? { service: text(item.service, 120), why: text(item.why, 260), strength: oneOf(item?.strength, ['strong', 'medium', 'weak'] as const, 'weak') } : null)) as CommercialBrief['fit']['services'],
      gaps: list(raw.fit?.gaps, 4, item => text(item, 240)) as string[],
    },
    company: {
      summary: text(raw.company?.summary, 500),
      facts: list(raw.company?.facts, 8, item => (text(item?.label, 40) ? { label: text(item.label, 40), value: text(item.value, 160) || 'No informado' } : null)) as CommercialBrief['company']['facts'],
    },
    buyers: list(raw.buyers, 6, item => (text(item?.title, 120) ? { title: text(item.title, 120), why: text(item.why, 240), priority: oneOf(item?.priority, ['primary', 'secondary'] as const, 'secondary') } : null)) as CommercialBrief['buyers'],
    approach: { angle: text(raw.approach?.angle, 420), hooks: list(raw.approach?.hooks, 4, item => text(item, 200)) as string[], avoid: list(raw.approach?.avoid, 3, item => text(item, 200)) as string[] },
    messages: list(raw.messages, 3, item => (text(item?.body, 900) ? { channel: oneOf(item?.channel, BRIEF_CHANNELS, 'email'), subject: text(item?.subject, 120), body: String(item.body).replace(/[ \t]+\n/g, '\n').trim().slice(0, 900) } : null)) as CommercialBrief['messages'],
    cadence: (list(raw.cadence, 7, item => (text(item?.action, 200) ? { day: Math.max(0, Math.min(45, Math.round(Number(item?.day) || 0))), channel: oneOf(item?.channel, CADENCE_CHANNELS, 'research'), action: text(item.action, 200) } : null)) as CommercialBrief['cadence'])
      .sort((a, b) => a.day - b.day),
    objections: list(raw.objections, 4, item => (text(item?.objection, 200) && text(item?.answer, 360) ? { objection: text(item.objection, 200), answer: text(item.answer, 360) } : null)) as CommercialBrief['objections'],
  };
  const usable = brief.headline || brief.whyNow.length || brief.fit.services.length || brief.company.summary || brief.buyers.length || brief.approach.angle || brief.messages.length || brief.cadence.length || brief.objections.length;
  return usable ? brief : undefined;
}
