// How much of the assistant's use a conversation and the day have taken (COW-15), so the person sees it before running into it.
// The caps are those of cowork_reserve_model_call (migration 20261023130000): per conversation and per person and day, in calls
// and in reserved output tokens; whichever is closer to its cap is the share that counts.
export const COWORK_CONVERSATION_CAP = { calls: 200, tokens: 1_000_000 };
export const COWORK_DAILY_CAP = { calls: 300, tokens: 1_800_000 };
/** From here on the page says that little is left. */
export const COWORK_USAGE_LOW = 0.8;

export type CoworkUsage = { conversation: number; today: number };

export function coworkUsageShare(reserved: number[], cap: { calls: number; tokens: number }) {
  const tokens = reserved.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return Math.min(1, Math.max(reserved.length / cap.calls, tokens / cap.tokens));
}

const percent = (share: number) => `${Math.min(100, Math.round(share * 100))} %`;

/** One quiet line for the summary panel. */
export function coworkUsageLine(usage: CoworkUsage) {
  return `Uso del asistente: esta conversación ${percent(usage.conversation)} · hoy ${percent(usage.today)}`;
}

/** What to say under the box when little is left, and whether a new conversation helps (it does not for the day's cap). */
export function coworkUsageWarning(usage: CoworkUsage | null | undefined): { text: string; newConversation: boolean } | null {
  if (!usage) return null;
  if (usage.today >= COWORK_USAGE_LOW) return { text: usage.today >= 1
    ? 'Llegaste al uso de hoy del asistente. Se renueva a medianoche, hora de Chile.'
    : `Llevas el ${percent(usage.today)} del uso de hoy del asistente. Se renueva a medianoche, hora de Chile.`, newConversation: false };
  if (usage.conversation >= COWORK_USAGE_LOW) return { text: `Esta conversación va en el ${percent(usage.conversation)} de su uso del asistente.`, newConversation: true };
  return null;
}
