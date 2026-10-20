import { z } from 'zod';

/**
 * «Cargar oportunidad» from a document: the invitation, the bases or the email the team received. The model reads it and
 * proposes the form's fields; the person reviews them before saving, and the document stays with the opportunity.
 */
export const PREFILL_KINDS = ['private_tender', 'proposal', 'quote', 'commercial'] as const;
export const PREFILL_MAX_CHARS = 50_000;

export const prefillAnswerSchema = z.object({
  title: z.string().max(500).nullable(),
  company: z.string().max(300).nullable(),
  url: z.string().max(2000).nullable(),
  kind: z.enum(PREFILL_KINDS).nullable(),
  description: z.string().max(4000).nullable(),
  deadline: z.string().max(40).nullable(),
  deadlineTimeGiven: z.boolean(),
  amount: z.number().nonnegative().nullable(),
  currency: z.string().max(8).nullable(),
});
export type PrefillAnswer = z.infer<typeof prefillAnswerSchema>;
export type PrefillFields = { title: string; company: string; url: string; kind: typeof PREFILL_KINDS[number]; description: string; deadline: string; amount: string; currency: string };

/** What the prompt says in place of the text when the document is a scan or a photo, attached for the model to read. */
export const PREFILL_SCANNED = '(El documento no tiene texto digital: va adjunto como imagen o PDF escaneado. Léelo ahí; lo que no se lea con seguridad va null.)';

export function prefillPrompt(input: { name: string; text: string; today: string }) {
  return `Lee el documento que recibió el equipo comercial (una invitación, unas bases, una solicitud de propuesta o cotización, o un correo) y completa el formulario para cargar la oportunidad. La persona revisará cada campo antes de guardar.

Hoy es ${input.today} en Chile.

Campos:
- title: nombre corto y claro de lo que se pide, como lo diría el equipo (máximo 120 caracteres). Sin «RE:», «FW:» ni códigos internos sueltos.
- company: el cliente o la entidad que invita o compra. null si no aparece.
- url: un enlace web que aparezca escrito en el documento y lleve a la convocatoria o sus bases. null si no hay.
- kind: private_tender si es una licitación o concurso privado; proposal si piden una propuesta (RFP, propuesta técnica y económica); quote si piden una cotización o precio; commercial si es otra oportunidad comercial.
- description: el contexto en hasta 1.200 caracteres, con lo que dice el documento: qué se pide y su alcance, requisitos importantes, cómo y dónde se presenta, contactos y fechas clave. Sin opiniones ni recomendaciones.
- deadline: el cierre o la fecha límite para presentar, como AAAA-MM-DDTHH:MM en hora de Chile. Si el año no aparece, usa la próxima vez que esa fecha ocurra desde hoy. Si no dice la hora, usa 23:59 y deadlineTimeGiven false. null si no hay fecha de cierre.
- amount y currency: el presupuesto o monto estimado si aparece (número sin separadores; currency CLP, UF, USD o EUR). null si no aparece. Nunca calcules ni estimes un monto.

Nunca inventes datos: lo que no está en el documento va null.

Documento «${input.name}»:
${input.text}`;
}

const isUrl = (value: string) => { try { return /^https?:$/.test(new URL(value).protocol); } catch { return false; } };

/** What the form gets: empty strings for what the document does not say, and the names of what it is missing. */
export function prefillFields(answer: PrefillAnswer): { fields: PrefillFields; missing: string[] } {
  const line = (value: string | null, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const deadline = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(answer.deadline ?? '').trim()) ? String(answer.deadline).trim() : '';
  const url = line(answer.url, 2000);
  const currency = line(answer.currency, 8).toUpperCase();
  const fields: PrefillFields = {
    title: line(answer.title, 200), company: line(answer.company, 300), url: isUrl(url) ? url : '',
    kind: answer.kind ?? 'private_tender', description: String(answer.description ?? '').trim().slice(0, 4000), deadline,
    amount: answer.amount !== null && Number.isFinite(answer.amount) && answer.amount > 0 ? String(Math.round(answer.amount * 100) / 100) : '',
    currency: ['CLP', 'UF', 'USD', 'EUR'].includes(currency) ? currency : 'CLP',
  };
  const missing = [
    !fields.title && 'el nombre', !fields.company && 'el cliente o la entidad', !fields.deadline && 'el cierre',
    fields.deadline && !answer.deadlineTimeGiven && 'la hora de cierre', !fields.amount && 'el monto',
  ].filter((value): value is string => Boolean(value));
  return { fields, missing };
}

/** The text the model reads: the document's sections with where each one comes from, up to the limit. */
export function prefillText(sections: Array<{ locator: string; text: string }>) {
  let text = '';
  for (const section of sections) {
    const body = section.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!body) continue;
    text += `${text ? '\n\n' : ''}[${section.locator}]\n${body}`;
    if (text.length >= PREFILL_MAX_CHARS) break;
  }
  return text.slice(0, PREFILL_MAX_CHARS);
}
