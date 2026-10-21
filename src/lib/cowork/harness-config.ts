// How the harness runtime of Cowork is switched on and what it is given. Off unless COWORK_RUNTIME=harness: the coordinator that has
// run until now (agent-loop.ts) stays the default, and a turn the harness cannot take (a task resumed from its specialists, a question
// about a proposal) goes to it too. Types only plus the settings reader: the server wires the pieces (worker.ts).
import type { z } from 'zod';
import type { Effort, ModelClient, ModelResponse } from '@/lib/agent-harness/index';
import { COWORK_MAX_COORDINATOR_CALLS } from './turn-budget';

export type CoworkHarnessCapability = { name: string; description: string; input: z.ZodTypeAny };

export type CoworkHarnessConfig = {
  model: ModelClient;
  /** The coordinator's rules for this turn (agent-instructions.ts), with the harness protocol on top. */
  system: string;
  /** The turn's context as the coordinator has always read it: history, memory, who the person is, what they asked. */
  context: string;
  /** The reads of the gateway, offered as tools. */
  capabilities: readonly CoworkHarnessCapability[];
  effort?: Effort;
  /** Calls to the model in the turn. The ledger admits five per run (cowork_reserve_model_call). */
  maxRounds: number;
  /** Reads that count in the turn; free ones (the writing context) do not. */
  maxReads: number;
  /** After this long the next call has to answer. */
  deadlineMs: number;
  /** A model that reads images (a Claude): with it, a document the agent reviews is also looked at page by page, as a person would. */
  documentReviewer?: ModelClient;
  /** Before each call: the ledger's reservation. Throwing ends the turn with the ledger's own message. */
  reserve?: () => Promise<string | undefined>;
  /** After each call: what it cost. */
  recordUsage?: (reservationId: string | undefined, response: ModelResponse, durationMs: number) => Promise<void>;
};

export type CoworkHarnessSettings = { model: string; effort: Effort; maxRounds: number; maxReads: number };

const bounded = (value: string | undefined, min: number, max: number, fallback: number) => {
  const number = Number(value);
  if (value === undefined || value.trim() === '' || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
};

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function coworkHarnessEnabled(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env) {
  return env.COWORK_RUNTIME?.trim() === 'harness';
}

/**
 * The harness runtime's settings, or null when it is off. The model is a Claude (COWORK_HARNESS_MODEL, Sonnet by default: the coordinator
 * is the part of Cowork that reads the most and decides the most). Rounds stay within what the ledger admits; with several tools asked
 * in one round, five rounds are enough for a turn that reads, proposes and answers.
 */
export function coworkHarnessSettings(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env): CoworkHarnessSettings | null {
  if (!coworkHarnessEnabled(env)) return null;
  const effort = EFFORTS.find(item => item === env.COWORK_HARNESS_EFFORT?.trim()) ?? 'medium';
  return {
    model: env.COWORK_HARNESS_MODEL?.trim() || 'claude-sonnet-5-5',
    effort,
    maxRounds: bounded(env.COWORK_HARNESS_MAX_ROUNDS, 2, COWORK_MAX_COORDINATOR_CALLS, COWORK_MAX_COORDINATOR_CALLS),
    maxReads: bounded(env.COWORK_HARNESS_MAX_READS, 1, 12, 6),
  };
}
