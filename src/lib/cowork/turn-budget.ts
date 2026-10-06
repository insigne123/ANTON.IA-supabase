/**
 * How much one Cowork turn may spend (plan 2.0). On each decision the coordinator
 * sees what is left and decides whether it needs another read or can answer: a
 * simple request still ends after one or two calls, and a longer one can bring
 * the data its next step needs instead of offering to look it up later. The
 * ceiling only bounds that choice; it is not a target.
 */
export type CoworkTurnCeiling = {
  /** Coordinator decisions (model calls) in one run, the closing correction included. */
  decisions: number;
  /** Reads in one run, shared by single reads, reads.parallel and reads.plan. */
  reads: number;
  /** Past this, the next decision answers with what it has, well before the worker's deadline. */
  softDeadlineMs: number;
};

/** cowork_reserve_model_call admits at most 5 coordinator calls per run: more needs a migration. */
export const COWORK_MAX_COORDINATOR_CALLS = 5;

/** The ceiling Cowork had before, kept as the default: on 27 sep, more reads and
 * decisions made turns slower without better answers (docs/cowork-techo-del-turno.md).
 * 50 s leaves room for a read and a closing decision before the worker's 105-second deadline. */
export const COWORK_TURN_DEFAULTS: CoworkTurnCeiling = { decisions: 4, reads: 3, softDeadlineMs: 50_000 };

/** What is left of the ceiling when the coordinator decides: decisionsLeft counts the ones after this decision. */
export type CoworkTurnBudget = { reads: number; readsLeft: number; decisionsLeft: number };

const bounded = (value: string | undefined, min: number, max: number, fallback: number) => {
  const number = Number(value);
  if (value === undefined || value.trim() === '' || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
};

/**
 * The ceiling from COWORK_MAX_DECISIONS_PER_TURN, COWORK_MAX_READS_PER_TURN and
 * COWORK_TURN_SOFT_DEADLINE_SECONDS, kept within what the worker allows: its
 * deadline is 105 s and a decision may take up to 30 s, so the soft deadline
 * stays at or under 75 s.
 */
export function coworkTurnCeiling(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env): CoworkTurnCeiling {
  return {
    decisions: bounded(env.COWORK_MAX_DECISIONS_PER_TURN, 2, COWORK_MAX_COORDINATOR_CALLS, COWORK_TURN_DEFAULTS.decisions),
    reads: bounded(env.COWORK_MAX_READS_PER_TURN, 1, 9, COWORK_TURN_DEFAULTS.reads),
    softDeadlineMs: bounded(env.COWORK_TURN_SOFT_DEADLINE_SECONDS, 20, 75, COWORK_TURN_DEFAULTS.softDeadlineMs / 1000) * 1000,
  };
}

/** How hard the coordinator thinks before each decision (COWORK_REASONING_EFFORT: low, medium or high; low by default, as before
 * Plan 13). More effort reasons better and takes longer, so each decision gets a little more time. */
export function coworkReasoningEffort(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env): 'low' | 'medium' | 'high' {
  const value = env.COWORK_REASONING_EFFORT;
  return value === 'medium' || value === 'high' ? value : 'low';
}

/** The time one coordinator decision may take at that effort. */
export function coworkDecisionTimeoutMs(effort: 'low' | 'medium' | 'high') {
  return effort === 'low' ? 30_000 : 40_000;
}
