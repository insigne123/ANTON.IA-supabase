/**
 * The first line of the message a scheduled task writes («⏰ Tarea programada · Resumen del lunes»), and how to recognize and read it.
 * Apart from schedules.ts so the lists of conversations can use it without the rest.
 */
export const COWORK_SCHEDULE_MARK = '⏰ Tarea programada';

/** Whether a conversation's first message is the one a scheduled task wrote. */
export function coworkIsScheduledMessage(message: string | null | undefined) {
  return typeof message === 'string' && message.startsWith(`${COWORK_SCHEDULE_MARK} · `);
}

/** The name of the task in the first line of its message, for the title of the conversation. */
export function coworkScheduledTitle(message: string | null | undefined) {
  if (!coworkIsScheduledMessage(message)) return null;
  return String(message).split('\n', 1)[0].slice(COWORK_SCHEDULE_MARK.length + 3).trim() || null;
}
