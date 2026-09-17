import type { CoworkExecutionMode } from './execution-policy';

export type CoworkThreadBudget = {
  /** Automatic worker-admitted steps in one chain (user followups reset the chain). */
  maxDepth: number;
  /** Executed/approved effects admitted without a fresh user message. */
  maxEffects: number;
  /** External provider searches executed without a fresh user message. */
  maxSearches: number;
  /** Draft generations requested without a fresh user message. */
  maxDrafts: number;
};

/** Fase 1 (CW-06): bounds for automatic chains. Human followups start a new chain,
 * so these caps never silence the user; they stop the worker from chaining alone.
 * Autonomous chains are tighter because each step self-approves. */
export function coworkThreadBudgets(mode: CoworkExecutionMode, autonomousEnabled: boolean): CoworkThreadBudget {
  const autonomous = mode === 'autonomous' && autonomousEnabled;
  return autonomous
    ? { maxDepth: 3, maxEffects: 3, maxSearches: 1, maxDrafts: 2 }
    : { maxDepth: 5, maxEffects: 6, maxSearches: 2, maxDrafts: 3 };
}
