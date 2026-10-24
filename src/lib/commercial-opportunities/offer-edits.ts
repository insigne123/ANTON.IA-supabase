// «Tu oferta» in the team's words (OPP-24): each part of the AI's draft (the cover letter, the opening of the technical offer, each
// of its sections and each answer of compliance) can be rewritten in place, by hand or by the AI with the team's indications. The
// AI's text stays under it, to see it again or go back to it. The edits live in the draft itself (draft.edits), so the page and the
// Word read the same text, and «Revisado por» says who read it last before it is handed in. Pure: the page, the server and the
// exports share it.
import { z } from 'zod';
import { offerFacts, type CompanyFacts, type OfferDraft } from './offer-draft';
import type { OpportunityReport } from './expedient';

/** A part as the team left it: the text, who wrote it and when; `ai` when the AI rewrote it at someone's request. */
export type OfferEdit = { text: string; by: string | null; at: string; ai?: boolean };
export type OfferEdits = Record<string, OfferEdit>;
/** Who read the whole offer before it is handed in, and when. */
export type OfferReview = { by: string; at: string };
/** A draft with what the team changed on it (OfferDraft carries both, optional). */
export type EditedOfferDraft = OfferDraft;

/** The longest text a part takes: a section of the technical offer, the longest part the AI writes. */
export const OFFER_PART_MAX = 6000;
/** «letter», «summary», «technical:2», «compliance:5». */
export const OFFER_PART = /^(letter|summary|technical:\d{1,2}|compliance:\d{1,2})$/;

/** The AI's text of a part, or null when the draft has no such part. */
export function offerPartText(draft: OfferDraft, part: string): string | null {
  if (part === 'letter') return draft.letter || null;
  if (part === 'summary') return draft.summary || null;
  const [kind, at] = part.split(':'); const index = Number(at);
  if (kind === 'technical') return draft.technical[index]?.body ?? null;
  if (kind === 'compliance') return draft.compliance[index]?.answer ?? null;
  return null;
}

/** What a part is called on the page and in the activity: «la carta de presentación», «la sección «Plan de trabajo»». */
export function offerPartName(draft: OfferDraft, part: string): string {
  if (part === 'letter') return 'la carta de presentación';
  if (part === 'summary') return 'el resumen de la oferta técnica';
  const [kind, at] = part.split(':'); const index = Number(at);
  if (kind === 'technical') return `la sección «${draft.technical[index]?.heading ?? `${index + 1}`}»`;
  return `la respuesta al requisito ${index + 1}`;
}

/** The edit of a part that still applies: one for a part the draft has, with text. */
const editOf = (draft: EditedOfferDraft, part: string) => {
  const edit = draft.edits?.[part];
  return edit && typeof edit.text === 'string' && edit.text.trim() && offerPartText(draft, part) !== null ? edit : null;
};
export const offerPartEdit = (draft: EditedOfferDraft, part: string): OfferEdit | null => editOf(draft, part);

/** The draft with one part's edit as the server saved it (null: back to the AI's text), for the page to show it without reading again. */
export function withPartEdit(draft: EditedOfferDraft, part: string, edit: OfferEdit | null): EditedOfferDraft {
  const edits: OfferEdits = { ...draft.edits };
  if (edit) edits[part] = edit; else delete edits[part];
  return { ...draft, edits };
}

/** The draft as the team left it: each edited part with its text. What the page shows, what is copied and what the Word carries. */
export function withOfferEdits(draft: EditedOfferDraft): OfferDraft {
  if (!draft.edits || !Object.keys(draft.edits).length) return draft;
  const text = (part: string, ai: string) => editOf(draft, part)?.text ?? ai;
  return {
    ...draft,
    letter: text('letter', draft.letter), summary: text('summary', draft.summary),
    technical: draft.technical.map((section, index) => ({ ...section, body: text(`technical:${index}`, section.body) })),
    compliance: draft.compliance.map((item, index) => ({ ...item, answer: text(`compliance:${index}`, item.answer) })),
  };
}

/**
 * The draft with one part changed: `text` replaces it, null goes back to the AI's text. The same text as the AI's is no edit. The
 * review stays as it was: the page compares it with the edits to say the offer changed after someone read it.
 */
export function editOfferPart(draft: EditedOfferDraft, part: string, change: { text: string | null; by: string | null; at: string; ai?: boolean }): EditedOfferDraft {
  const original = offerPartText(draft, part);
  if (original === null) throw new Error(`The draft has no part ${part}`);
  const rest: OfferEdits = { ...draft.edits };
  delete rest[part];
  const text = change.text === null ? null : change.text.replace(/\r\n?/g, '\n').trim().slice(0, OFFER_PART_MAX);
  const edits: OfferEdits = text && text !== original.trim() ? { ...rest, [part]: { text, by: change.by, at: change.at, ...(change.ai ? { ai: true } : {}) } } : rest;
  return { ...draft, edits };
}

/** When the offer last changed by the team's hand or at its request; null while it is the AI's draft as it came. */
export const lastOfferEdit = (draft: EditedOfferDraft): string | null =>
  Object.keys(draft.edits || {}).map(part => editOf(draft, part)?.at).filter((at): at is string => Boolean(at)).sort().pop() ?? null;

/** Whether the review still holds: nobody changed a part after it. */
export const offerReviewHolds = (draft: EditedOfferDraft) => {
  if (!draft.review) return false;
  const last = lastOfferEdit(draft);
  return !last || Date.parse(last) <= Date.parse(draft.review.at);
};

const uuid = z.string().uuid();
const part = z.string().regex(OFFER_PART);
/** A part written by hand (text) or back to the AI's (null), from the edit the person saw (base: its `at`, or null for the AI's). */
export const offerEditSchema = z.object({ draftId: uuid, part, text: z.string().max(OFFER_PART_MAX * 2).nullable(), base: z.string().max(40).nullable() }).strict();
/** «Pedir cambios a la IA»: what to change in one part. */
export const offerRewriteSchema = z.object({ draftId: uuid, part, instructions: z.string().trim().min(3).max(800), base: z.string().max(40).nullable(), requestId: uuid }).strict();
/** «Marcar como revisado», or taking it back. */
export const offerReviewSchema = z.object({ draftId: uuid, reviewed: z.boolean() }).strict();

/** What the AI answers when it rewrites one part: the new text, alone. */
export const offerPartSchema = z.object({ text: z.string().max(OFFER_PART_MAX * 2) });

/**
 * The prompt to rewrite one part with the team's indications. The same rules as the whole draft (offerDraftPrompt): nothing the
 * company did not give, and what is missing between brackets. The documents, the report and the current text are data.
 */
export function offerPartPrompt(input: { opportunity: { title: string; buyer: string | null }; draft: OfferDraft; part: string; text: string; instructions: string;
  company: CompanyFacts; report: OpportunityReport | null }) {
  const [kind, at] = input.part.split(':');
  const section = kind === 'technical' ? input.draft.technical[Number(at)] : null;
  const requirement = kind === 'compliance' ? input.draft.compliance[Number(at)]?.requirement : null;
  // The facts of the bases, fewer than for the whole draft: one part needs the ones about it.
  const facts: ReturnType<typeof offerFacts> = []; let size = 0;
  for (const fact of input.report ? offerFacts(input.report) : []) { size += JSON.stringify(fact).length; if (size > 20_000) break; facts.push(fact); }
  return `Reescribe ${offerPartName(input.draft, input.part)} del borrador de oferta según lo que pide el equipo. Entrega solo el texto nuevo de esa parte.
Escribe en español de Chile, formal y concreto, como se escribe una oferta a un organismo público. Frases cortas, sin relleno ni adjetivos vacíos.

REGLAS
- Lo que pide el equipo manda sobre la forma: énfasis, extensión, orden, tono.
- Nunca inventes experiencia, años, clientes, personal, certificaciones, equipos, plazos ni precios. Usa solo lo que dicen el texto actual, la empresa y los hechos de las bases; lo que falte va como marcador entre corchetes, por ejemplo [N.º de contratos similares].
- Conserva los marcadores entre corchetes del texto actual, salvo que lo que pide el equipo los complete.
- Sin título, sin comillas alrededor, sin comentarios sobre los cambios.${kind === 'letter' ? '\n- Es solo el CUERPO de la carta: sin fecha, destinatario, saludo, despedida ni firma.' : ''}${kind === 'compliance' ? '\n- Es la respuesta a un requisito, en primera persona plural: «Cumplimos: …» y cómo, solo si la empresa lo respalda.' : ''}

LO QUE PIDE EL EQUIPO: ${input.instructions.slice(0, 800)}
OPORTUNIDAD: ${JSON.stringify({ titulo: input.opportunity.title, organismo: input.opportunity.buyer })}
${section ? `SECCION: ${JSON.stringify({ titulo: section.heading, criterio: section.criterion || null, ponderacion: section.weight || null })}\n` : ''}${requirement ? `REQUISITO: ${JSON.stringify(requirement)}\n` : ''}TEXTO ACTUAL: ${JSON.stringify(input.text.slice(0, OFFER_PART_MAX))}
EMPRESA: ${JSON.stringify({ oferta: input.company.offer.slice(0, 3000), servicios: input.company.services.slice(0, 30), territorios: input.company.territories, noOfrece: input.company.exclusions,
  perfil: input.company.profile ? input.company.profile.slice(0, 2000) : undefined, ...(input.company.extras || {}), ...(input.company.ficha ? { fichaParaLicitaciones: input.company.ficha } : {}) })}
HECHOS DE LAS BASES (con su cita): ${JSON.stringify(facts)}`;
}
