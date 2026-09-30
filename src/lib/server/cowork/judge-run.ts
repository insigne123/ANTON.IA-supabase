import type { z } from 'zod';
import type { StructuredResult, StructuredTelemetry } from '@/ai/openai-json';
import { COWORK_AGENT_ACTION } from '@/lib/cowork/contracts';
import type { CoworkAnswer, CoworkObservation } from '@/lib/cowork/agent-loop';
import { coworkJudgeFix, coworkJudgeInstructions, coworkJudgeSchema, coworkJudgeTurnPrompt, type CoworkJudgement } from '@/lib/cowork/judge';
import type { CoworkAgentStep } from '@/lib/cowork/writer';

/** The judge reads the coordinator's final answer before it is shown (plan 2, G2). Off, the answer goes out as before. */
export function coworkJudgeEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_JUDGE_ENABLED === 'true';
}

/** COWORK_JUDGE_MODEL picks its model; COWORK_MODEL by default. */
export function coworkJudgeModel(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_JUDGE_MODEL || env.COWORK_MODEL;
}

/** The judge's call: what the ledger reserves for the role (20260928030000) and how long it may take. */
const CALL = { maxOutputTokens: 1500, timeoutMs: 15_000 } as const;
/** The judge's call and the coordinator's correction after it (a decision may take 30 s) fit before the deadline. */
const REVIEW_MS = CALL.timeoutMs + 30_000;

type Generate = <T extends z.ZodTypeAny>(options: {
  schema: T; systemPrompt: string; prompt: string; provider: 'openai'; openAiModel?: string; allowDefaultModelFallback: false;
  maxAttempts: number; timeoutMs: number; maxOutputTokens: number; signal: AbortSignal;
}) => Promise<StructuredResult<T>>;

/**
 * The worker's judge for runCoworkReadLoop, under the run's lease: `review` reads
 * the coordinator's final answer and returns what to fix, or null when it stands
 * (clean, no time, or the call failed); `finish` records how the correction ended
 * once the loop returns. The call reserves the `judge` role in the ledger, records
 * its usage and fits in the time the turn has left. Each step is recorded as an
 * event for the page, where the judge shows as the Reviewer.
 */
export function coworkJudgeTurn(deps: {
  request: string;
  history: Array<{ request: string; reply: string; observations?: unknown[] }>;
  userContext: unknown;
  signal: AbortSignal;
  authorize: () => Promise<void>;
  reserve: () => Promise<string | undefined>;
  generate: Generate;
  recordUsage: (reservationId: string | undefined, telemetry: StructuredTelemetry) => Promise<unknown>;
  record: (event: { action: typeof COWORK_AGENT_ACTION; input: ''; result: CoworkAgentStep }) => Promise<void>;
  liveDraft: { review: () => void; flush: () => Promise<void> } | null;
  timeLeft: () => number;
  model?: string;
  /** contacts.import is on in this turn (F4): the judge reads the same rules as the coordinator. */
  contactsImport?: boolean;
  onCall?: (call: { model: string; durationMs: number }) => void;
}) {
  // The answer the judge asked to fix: the loop returns it unchanged when the correction fails.
  let asked: CoworkAnswer | null = null;
  const step = async (result: CoworkAgentStep) => {
    deps.signal.throwIfAborted();
    await deps.authorize();
    await deps.record({ action: COWORK_AGENT_ACTION, input: '', result });
  };
  return {
    review: async (answer: CoworkAnswer, observations: CoworkObservation[], turn: { canRead: boolean } = { canRead: true }): Promise<string | null> => {
      if (deps.timeLeft() < REVIEW_MS) return null;
      await step({ agent: 'judge', state: 'working', label: 'Revisando la respuesta' });
      // The text on screen stays, marked as being reviewed, until the final answer replaces it.
      deps.liveDraft?.review();
      let judgement: CoworkJudgement;
      try {
        await deps.liveDraft?.flush();
        const reservationId = await deps.reserve();
        const call = await deps.generate({
          schema: coworkJudgeSchema, systemPrompt: coworkJudgeInstructions({ contactsImport: deps.contactsImport, inTurn: true }),
          prompt: coworkJudgeTurnPrompt({ request: deps.request, history: deps.history, userContext: deps.userContext, observations, answer }),
          provider: 'openai', openAiModel: deps.model, allowDefaultModelFallback: false, maxAttempts: 1,
          timeoutMs: Math.min(CALL.timeoutMs, deps.timeLeft()), maxOutputTokens: CALL.maxOutputTokens, signal: deps.signal,
        });
        await deps.recordUsage(reservationId, call.telemetry);
        deps.onCall?.({ model: call.telemetry.modelName, durationMs: call.telemetry.durationMs });
        judgement = call.data;
      } catch (error) {
        if (deps.signal.aborted) throw error;
        // Without a verdict the answer goes out as it is.
        await step({ agent: 'judge', state: 'done', label: 'No alcanzó a revisar', outcome: 'skipped', changes: [] });
        return null;
      }
      const fix = coworkJudgeFix(judgement, { canRead: turn.canRead, question: answer.question });
      if (!fix) {
        await step({ agent: 'judge', state: 'done', label: 'Sin ajustes', outcome: 'clean', changes: [] });
        return null;
      }
      asked = answer;
      await step({ agent: 'judge', state: 'working', label: 'Ajustando la respuesta' });
      return fix;
    },
    /** After the loop (or when it failed, with null): a result other than the judged answer is the fix. */
    finish: async (result: unknown) => {
      if (!asked) return;
      const fixed = result !== null && result !== asked;
      asked = null;
      await step(fixed
        ? { agent: 'judge', state: 'done', label: 'Ajustó la respuesta', outcome: 'fixed', changes: [] }
        : { agent: 'judge', state: 'done', label: 'No alcanzó a ajustarla', outcome: 'skipped', changes: [] });
    },
  };
}
