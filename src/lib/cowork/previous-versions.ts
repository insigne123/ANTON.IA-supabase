import { coworkFeedbackSchema, COWORK_FEEDBACK_EVENT, COWORK_FEEDBACK_REASONS, type CoworkFeedbackReason } from './turn-actions';

/**
 * «Otra versión» that knows what did not work (Plan 13): the answers Cowork already gave to this same message, with what the
 * person said about them (👎 and why), so the new version is different and better instead of a reshuffle of the same one.
 * Also what the person said about the answers of the conversation, so a «Demasiado largo» shapes the next one.
 */
export type CoworkAnswerFeedback = { rating: 'up' | 'down'; reason: string | null; comment: string | null };
export type CoworkPreviousVersion = { reply: string; feedback: CoworkAnswerFeedback | null };

/** At most this many earlier versions travel, newest first, each cut to this length. */
export const COWORK_PREVIOUS_VERSIONS_MAX = 2;
export const COWORK_PREVIOUS_VERSION_LENGTH = 800;

const REASON_LABEL = new Map<string, string>(COWORK_FEEDBACK_REASONS.map(reason => [reason.id, reason.label]));

/** The latest 👍/👎 among a run's events, with its reason in the person's words; null when there is none (or it was taken back). */
export function coworkAnswerFeedback(events: Array<{ kind: string; payload: unknown }>): CoworkAnswerFeedback | null {
  const last = events.filter(event => event.kind === COWORK_FEEDBACK_EVENT).at(-1);
  const parsed = last ? coworkFeedbackSchema.safeParse(last.payload) : null;
  if (!parsed?.success || !parsed.data.rating) return null;
  return { rating: parsed.data.rating, reason: parsed.data.reason ? REASON_LABEL.get(parsed.data.reason as CoworkFeedbackReason) ?? null : null,
    comment: parsed.data.comment };
}

export function coworkVersionExcerpt(reply: string) {
  const text = String(reply || '').trim();
  return text.length > COWORK_PREVIOUS_VERSION_LENGTH ? `${text.slice(0, COWORK_PREVIOUS_VERSION_LENGTH - 1).trimEnd()}…` : text;
}

export const COWORK_PREVIOUS_VERSIONS_INSTRUCTION = 'El usuario pidió otra versión de tu respuesta a este mismo mensaje: previousVersions trae las que ya le diste, la más reciente primero, con su opinión si la dio (feedback: down y por qué). Da una respuesta distinta y mejor: cambia el enfoque, la estructura o el ejemplo, no repitas el mismo texto ni la misma propuesta, y si hay un motivo («Demasiado largo», «Datos incorrectos», «No hizo lo que pedí», «Poco útil» o un comentario), corrígelo primero, sin quitar el siguiente paso ni las respuestas sugeridas. Mantén los datos verdaderos que ya consultaste. No menciones que es otra versión, salvo que corrijas un dato: entonces dilo en una frase.';

export const COWORK_HISTORY_FEEDBACK_INSTRUCTION = 'Algunos turnos de history traen feedback: lo que el usuario dijo de esa respuesta (up le sirvió; down no, con el motivo y su comentario). Tenlo en cuenta en esta respuesta sin mencionarlo: si dijo «Demasiado largo», sé más breve; si «Datos incorrectos», revisa la cifra antes de repetirla; si «No hizo lo que pedí», vuelve a lo que pidió. Más breve nunca quita lo útil: sigue cerrando con el siguiente paso (answer.question) y las respuestas sugeridas.';
