import { z } from 'zod';
import type { CoworkEvent, CoworkRun } from './contracts';
import { coworkMessageAttachments, coworkWithAttachments } from './attachments';
import { coworkDisplayMessage } from './presentation';

/**
 * What you can do with a turn once it is done, as in any AI chat (Plan 13): edit your last message, ask for another version of
 * the answer, move between the versions and say whether it helped. A new version or an edited message is a new run with the
 * same parent as the one it replaces, so the conversation that follows (and what Cowork reads as history) is the version on
 * screen; the others stay a click away.
 */

/** The text of your message as the bubble shows it: no attached files, no contact references. */
export function coworkEditableText(message: string) {
  return coworkDisplayMessage(coworkMessageAttachments(message).text);
}

const REFERENCE = /\(ID(?: del contacto| de ([^():\n]{1,80}))?\s*:?\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)/gi;

/**
 * Your edited message as it is sent: the new text, the contact reference it carried and the references of the people you
 * still name with «@», then its files. Editing the words never loses who or what the message was about.
 */
export function coworkEditedMessage(original: string, edited: string) {
  const { text, files } = coworkMessageAttachments(original);
  const body = edited.trim();
  const references = [...text.matchAll(REFERENCE)]
    .filter(match => !match[1] || body.includes(`@${match[1].trim()}`))
    .map(match => match[0]);
  const withReferences = references.length ? `${body}\n\n${[...new Set(references)].join('\n')}` : body;
  return coworkWithAttachments(withReferences, files);
}

export type CoworkTurnVersions = { index: number; total: number; ids: string[] };

const time = (value: string) => Date.parse(value) || 0;

/**
 * The versions of a turn: the messages you sent after the same answer (another version, an edit), oldest first. Failed or
 * stopped attempts are not versions, except the one on screen. Null when there is only one, or for the first turn, whose
 * new version starts the conversation again.
 */
export function coworkTurnVersions(runs: CoworkRun[], run: CoworkRun): CoworkTurnVersions | null {
  if (!run.parent_run_id || run.automatic) return null;
  const siblings = runs.filter(other => other.parent_run_id === run.parent_run_id && !other.automatic
    && (other.status === 'completed' || other.id === run.id));
  if (!siblings.some(other => other.id === run.id)) siblings.push(run);
  if (siblings.length < 2) return null;
  const ids = siblings.sort((a, b) => time(a.created_at) - time(b.created_at) || a.id.localeCompare(b.id)).map(other => other.id);
  return { index: ids.indexOf(run.id), total: ids.length, ids };
}

/** Where a version continues: the newest turn that follows from it (itself when nothing does). */
export function coworkVersionLeaf(runs: CoworkRun[], id: string) {
  const byId = new Map(runs.map(run => [run.id, run]));
  let best = byId.get(id) ?? null;
  for (const run of runs) {
    let cursor: CoworkRun | undefined = run;
    for (let step = 0; cursor && step < 30; step++) {
      if (cursor.id === id) {
        if (!best || time(run.created_at) > time(best.created_at)) best = run;
        break;
      }
      cursor = cursor.parent_run_id ? byId.get(cursor.parent_run_id) : undefined;
    }
  }
  return best?.id ?? id;
}

/** Why an answer did not help, in a click; the comment says the rest. */
export const COWORK_FEEDBACK_REASONS = [
  { id: 'not_what_i_asked', label: 'No hizo lo que pedí' },
  { id: 'wrong_data', label: 'Datos incorrectos' },
  { id: 'too_long', label: 'Demasiado largo' },
  { id: 'not_useful', label: 'Poco útil' },
] as const;

export type CoworkFeedbackReason = typeof COWORK_FEEDBACK_REASONS[number]['id'];
const REASON_IDS = COWORK_FEEDBACK_REASONS.map(reason => reason.id) as [CoworkFeedbackReason, ...CoworkFeedbackReason[]];

/** 👍 or 👎 (null takes it back), with an optional reason and comment. */
export const coworkFeedbackSchema = z.object({
  rating: z.enum(['up', 'down']).nullable(),
  reason: z.enum(REASON_IDS).nullable().default(null),
  comment: z.string().trim().max(500, 'Usa hasta 500 caracteres.').nullable().default(null)
    .transform(value => value || null),
}).strict();

export type CoworkFeedback = z.infer<typeof coworkFeedbackSchema>;

/** The run event that keeps it: the latest one counts. */
export const COWORK_FEEDBACK_EVENT = 'answer.feedback';

/** What you said about this answer, if you said something (and did not take it back). */
export function coworkTurnFeedback(events: CoworkEvent[]): (CoworkFeedback & { rating: 'up' | 'down' }) | null {
  const last = events.slice().reverse().find(event => event.kind === COWORK_FEEDBACK_EVENT);
  const parsed = last ? coworkFeedbackSchema.safeParse(last.payload) : null;
  return parsed?.success && parsed.data.rating ? { ...parsed.data, rating: parsed.data.rating } : null;
}
