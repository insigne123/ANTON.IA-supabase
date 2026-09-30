/**
 * Who reviews Cowork's final answer before it is shown (COWORK_REVIEW_ENGINE):
 * - llm: the model that judges (the Jueza, judge-run.ts), as it always was;
 * - jev: Jev alone (src/lib/server/jev.ts), with the one question calibrated in docs/cowork-jev.md;
 * - jev-llm: Jev first, and the model only when that question passes its high-coverage threshold or Jev did not answer;
 * - off: nobody reviews.
 * Without a value it follows COWORK_JUDGE_ENABLED, so nothing changes for whoever never set it. A value that is not one of
 * these (a typo) is no value either: the review never turns on by a mistake.
 *
 * COWORK_JEV_SHADOW lets Jev answer next to the review (or alone, when nobody reviews) and only record what it says, to
 * measure it with real conversations before it decides anything.
 */
export const COWORK_REVIEW_ENGINES = ['llm', 'jev', 'jev-llm', 'off'] as const;
export type CoworkReviewEngine = typeof COWORK_REVIEW_ENGINES[number];

export function coworkReviewEngine(env: Record<string, string | undefined> = process.env): CoworkReviewEngine {
  const asked = env.COWORK_REVIEW_ENGINE?.trim().toLowerCase();
  const known = COWORK_REVIEW_ENGINES.find(engine => engine === asked);
  if (known) return known;
  return env.COWORK_JUDGE_ENABLED === 'true' ? 'llm' : 'off';
}

/** Jev answers next to the review and only records (it decides nothing). */
export function coworkJevShadow(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_JEV_SHADOW === 'true';
}

/** How long Jev may take inside a turn: half a second longer than its usual p95 (194 ms), well under the judge's 15 s. */
export const COWORK_JEV_TURN_TIMEOUT_MS = 1_500;
