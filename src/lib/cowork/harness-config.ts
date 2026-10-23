// How the harness runtime of Cowork is switched on and what it is given. Off unless COWORK_RUNTIME=harness: the coordinator that has
// run until now (agent-loop.ts) stays the default, and a turn the harness cannot take (a task resumed from its specialists, a question
// about a proposal) goes to it too. Types only plus the settings reader: the server wires the pieces (worker.ts).
import type { z } from 'zod';
import type { Effort, ModelClient, ModelResponse, WebSettings } from '@/lib/agent-harness/index';
import { isBlockedModel } from '@/ai/blocked-models';
import { COWORK_MAX_COORDINATOR_CALLS } from './turn-budget';
import type { CoworkSubagentSettings } from './subagents';

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
  /** The web: the API's own search and page reading, with what the turn may spend on them (COWORK_WEB_ENABLED). Without it the agent has no web. */
  web?: WebSettings;
  /** Before each call: the ledger's reservation. Throwing ends the turn with the ledger's own message. */
  reserve?: () => Promise<string | undefined>;
  /**
   * The Investigadoras the coordinator can hand a research to (COWORK_SUBAGENTS_ENABLED; they need the web). Each of their calls to the
   * model is reserved under the role «delegate», which has its own room in the turn (migration 20261023130000).
   */
  subagents?: {
    settings: CoworkSubagentSettings;
    model: ModelClient;
    reserve?: () => Promise<string | undefined>;
    recordUsage?: (reservationId: string | undefined, response: ModelResponse, durationMs: number) => Promise<void>;
  };
  /**
   * The answer as the model writes it (the JSON of `responder` so far, wrapped as the decision the page's live draft reads), and whether it is a
   * correction of an answer the judge sent back (the page then says «revisando» instead of rewriting what it already showed).
   */
  onAnswerPartial?: (decisionPrefix: string, correcting: boolean) => void;
  /** The judge sent the answer back: say so. */
  onAnswerReview?: () => void;
  /** The turn is about to finish: write the last state of the draft. */
  flushAnswer?: () => Promise<void>;
  /** After each call: what it cost. */
  recordUsage?: (reservationId: string | undefined, response: ModelResponse, durationMs: number) => Promise<void>;
  /** The turn could not finish on the harness (Anthropic failed) and goes on with the coordinator loop: say so, for whoever reviews the turn later. */
  onFallback?: (reason: string) => void;
};

export type CoworkHarnessSettings = { model: string; effort: Effort; maxRounds: number; maxReads: number; web: WebSettings | null; subagents: CoworkSubagentSettings | null };

const bounded = (value: string | undefined, min: number, max: number, fallback: number) => {
  const number = Number(value);
  if (value === undefined || value.trim() === '' || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
};

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The web is off unless COWORK_WEB_ENABLED=true. Each search is billed on top of the tokens (the price goes in COWORK_MODEL_PRICING_JSON as
 * webSearchUsdPerThousand), so a turn has a small budget: COWORK_WEB_MAX_SEARCHES (4) and COWORK_WEB_MAX_FETCHES (3). The agent looks from Chile
 * (COWORK_WEB_COUNTRY, CL) and never reads the domains in COWORK_WEB_BLOCKED_DOMAINS (comma separated).
 */
export function coworkWebSettings(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env): WebSettings | null {
  if (env.COWORK_WEB_ENABLED?.trim() !== 'true') return null;
  const searches = bounded(env.COWORK_WEB_MAX_SEARCHES, 0, 10, 4);
  const fetches = bounded(env.COWORK_WEB_MAX_FETCHES, 0, 8, 3);
  if (searches + fetches === 0) return null;
  const blocked = (env.COWORK_WEB_BLOCKED_DOMAINS ?? '').split(',').map(domain => domain.trim().toLowerCase()).filter(domain => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)).slice(0, 20);
  const country = (env.COWORK_WEB_COUNTRY ?? 'CL').trim().toUpperCase();
  return {
    searches, fetches, maxPageTokens: 20_000,
    // COWORK_WEB_BASIC=true: the tools without dynamic filtering (see WebSettings.basic).
    ...(env.COWORK_WEB_BASIC?.trim() === 'true' ? { basic: true } : {}),
    ...(blocked.length ? { blockedDomains: blocked } : {}),
    ...(/^[A-Z]{2}$/.test(country) ? { country, ...(country === 'CL' ? { timezone: 'America/Santiago' } : {}) } : {}),
  };
}

/**
 * The Investigadoras (sub-agents) are off unless COWORK_SUBAGENTS_ENABLED=true, and they need the web (they have nothing else). The model is
 * COWORK_SUBAGENT_MODEL (the coordinator's by default), they think little (COWORK_SUBAGENT_EFFORT, low) and each has its own small
 * budget: COWORK_SUBAGENT_SEARCHES (3), COWORK_SUBAGENT_FETCHES (2), COWORK_SUBAGENT_MAX_ROUNDS (4) and COWORK_SUBAGENT_DEADLINE_MS (45 s).
 * The coordinator hands out at most COWORK_SUBAGENTS_MAX (3) tasks per turn.
 */
export function coworkSubagentSettings(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env, web: WebSettings | null = coworkWebSettings(env)): CoworkSubagentSettings | null {
  if (env.COWORK_SUBAGENTS_ENABLED?.trim() !== 'true' || !web) return null;
  const model = env.COWORK_SUBAGENT_MODEL?.trim() || env.COWORK_HARNESS_MODEL?.trim() || 'claude-haiku-5-5';
  // An expensive tier does not run them (src/ai/blocked-models.ts): without sub-agents the coordinator reads the web itself.
  if (isBlockedModel(model)) return null;
  return {
    model,
    effort: EFFORTS.find(item => item === env.COWORK_SUBAGENT_EFFORT?.trim()) ?? 'low',
    maxDelegations: bounded(env.COWORK_SUBAGENTS_MAX, 1, 5, 3),
    maxRounds: bounded(env.COWORK_SUBAGENT_MAX_ROUNDS, 2, 6, 4),
    searches: bounded(env.COWORK_SUBAGENT_SEARCHES, 1, 6, 3),
    fetches: bounded(env.COWORK_SUBAGENT_FETCHES, 0, 4, 2),
    deadlineMs: bounded(env.COWORK_SUBAGENT_DEADLINE_MS, 15_000, 60_000, 45_000),
  };
}

/**
 * Whether this person's turns run on the harness. COWORK_RUNTIME=harness turns it on; COWORK_HARNESS_USER_IDS (user ids, comma separated)
 * limits it to those people while it is tried, and everyone else keeps the coordinator loop. Empty or absent, it is everyone.
 */
export function coworkHarnessEnabled(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env, userId?: string | null) {
  if (env.COWORK_RUNTIME?.trim() !== 'harness') return false;
  // A coordinator of an expensive tier is never run (src/ai/blocked-models.ts): Cowork keeps the coordinator loop on its own model
  // instead of failing every turn.
  if (isBlockedModel(env.COWORK_HARNESS_MODEL)) return false;
  const pilot = (env.COWORK_HARNESS_USER_IDS ?? '').split(',').map(id => id.trim().toLowerCase()).filter(Boolean);
  return !pilot.length || (Boolean(userId) && pilot.includes(String(userId).toLowerCase()));
}

/** Whether this person's turns can search the web: the harness is theirs and the web is on. Nothing else in Cowork has a web. */
export function coworkWebAvailable(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env, userId?: string | null) {
  return coworkHarnessEnabled(env, userId) && coworkWebSettings(env) !== null;
}

/**
 * The harness runtime's settings, or null when it is off. The model is a Claude (COWORK_HARNESS_MODEL, Haiku by default, the only Claude allowed with Sonnet out: the coordinator
 * is the part of Cowork that reads the most and decides the most). Rounds stay within what the ledger admits; with several tools asked
 * in one round, five rounds are enough for a turn that reads, proposes and answers.
 */
export function coworkHarnessSettings(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env, userId?: string | null): CoworkHarnessSettings | null {
  if (!coworkHarnessEnabled(env, userId)) return null;
  const effort = EFFORTS.find(item => item === env.COWORK_HARNESS_EFFORT?.trim()) ?? 'medium';
  return {
    model: env.COWORK_HARNESS_MODEL?.trim() || 'claude-haiku-5-5',
    effort,
    maxRounds: bounded(env.COWORK_HARNESS_MAX_ROUNDS, 2, COWORK_MAX_COORDINATOR_CALLS, COWORK_MAX_COORDINATOR_CALLS),
    maxReads: bounded(env.COWORK_HARNESS_MAX_READS, 1, 12, 6),
    web: coworkWebSettings(env),
    subagents: coworkSubagentSettings(env),
  };
}
