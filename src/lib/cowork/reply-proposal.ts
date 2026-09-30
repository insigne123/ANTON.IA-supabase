import { z } from 'zod';

/**
 * The reply Cowork proposes to send inside a conversation («responder dentro del hilo»). Only the rules live here:
 * what the model may say and how the subject is written. The server stages the exact text for the approval card
 * (server/cowork/reply-thread-effect.ts) and the approved effect sends that text in the thread of that conversation.
 * The recipient is never part of the proposal: it is the person of the conversation, read from the sent email.
 */

export const COWORK_REPLY_SUBJECT_MAX = 300;
export const COWORK_REPLY_BODY_MAX = 8000;

/** email.reply_thread: the conversation read with replies.thread and the final text of the reply. */
export const coworkReplyThreadSchema = z.object({
  contactedId: z.string().uuid(),
  subject: z.string().trim().min(1).max(COWORK_REPLY_SUBJECT_MAX),
  body: z.string().trim().min(1).max(COWORK_REPLY_BODY_MAX),
}).strict();
export type CoworkReplyThreadInput = z.infer<typeof coworkReplyThreadSchema>;

/** «Re: » once, whatever the model wrote («RE:», «Rv:», «Re: Re:»): the subject the reply travels with. */
export function coworkReplySubject(subject: string) {
  const clean = String(subject || '').replace(/[\r\n]+/g, ' ').replace(/^(\s*(re|rv)\s*:\s*)+/i, '').trim();
  return `Re: ${clean}`.slice(0, COWORK_REPLY_SUBJECT_MAX).trim();
}

/** The text as it is sent: line breaks normalized, no stray spaces at the ends of lines, no runs of blank lines. */
export function coworkReplyBody(body: string) {
  return String(body || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
