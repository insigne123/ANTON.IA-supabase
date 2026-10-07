/**
 * The model that rescues a turn about to fail (Plan 14, 2): COWORK_RESCUE_MODEL, gpt-6.1-sol in production. Unset, there is
 * no rescue and a failed turn says so as before. The owner's rule is that astra is never used in ANTON.IA (6 Oct 2026): a
 * setting that names it turns the rescue off instead of calling it.
 */
export function coworkRescueModel(env: Record<string, string | undefined> = process.env): string | null {
  const model = env.COWORK_RESCUE_MODEL?.trim();
  if (!model || /astra/i.test(model)) return null;
  return model.slice(0, 120);
}

/** The least time a rescue needs to answer: with less, the turn fails as before instead of being cut off mid-answer. */
export const COWORK_RESCUE_MIN_MS = 12_000;

/** How long the rescue may take, within what is left of the turn: measured with gpt-6.1-sol, an account brief took 32.5 s,
 * past the 30 s of a regular decision. */
export const COWORK_RESCUE_TIMEOUT_MS = 45_000;
