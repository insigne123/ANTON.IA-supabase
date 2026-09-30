import type { z } from 'zod';
import type { StructuredResult, StructuredTelemetry } from '@/ai/openai-json';
import { COWORK_AGENT_ACTION } from '@/lib/cowork/contracts';
import type { CoworkAnswer, CoworkObservation } from '@/lib/cowork/agent-loop';
import { coworkWriterBlocks, runCoworkWriter, type CoworkAgentStep, type CoworkWriteBrief } from '@/lib/cowork/writer';

/** The Writer and the Reviewer write the emails of a turn (plan 2, G1). Off, the coordinator writes them as before. */
export function coworkWriterEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_WRITER_ENABLED === 'true';
}

/** COWORK_WRITER_MODEL and COWORK_REVIEWER_MODEL pick their models; COWORK_MODEL by default. */
export function coworkWriterModels(env: Record<string, string | undefined> = process.env) {
  return { writer: env.COWORK_WRITER_MODEL || env.COWORK_MODEL, reviewer: env.COWORK_REVIEWER_MODEL || env.COWORK_MODEL };
}

/** Each call's limits: what the ledger reserves for the role (20260928030000) and how long it may take. */
const CALLS = {
  writer: { maxOutputTokens: 6000, timeoutMs: 30_000, minimumMs: 15_000 },
  reviewer: { maxOutputTokens: 1500, timeoutMs: 15_000, minimumMs: 6_000 },
} as const;
/** A review and one correction take a reviewer call and a writer call. */
const REVIEW_MS = CALLS.reviewer.minimumMs + CALLS.writer.minimumMs;
/** The Writer's streamed answer, read as a coordinator answer so the live draft shows it. */
const LIVE_PREFIX = '{"action":"answer","answer":';

type Generate = <T extends z.ZodTypeAny>(options: {
  schema: T; systemPrompt: string; prompt: string; provider: 'openai'; openAiModel?: string; allowDefaultModelFallback: false;
  maxAttempts: number; timeoutMs: number; maxOutputTokens: number; signal: AbortSignal; onPartial?: (content: string) => void;
}) => Promise<StructuredResult<T>>;

/**
 * The worker's `write` for runCoworkReadLoop: the Writer and the Reviewer under the
 * run's lease. Each call reserves its role in the ledger, records its usage, and
 * fits in the time the turn has left (`timeLeft`, before the worker's deadline);
 * the Writer streams into the live draft, and each agent's step is recorded as an
 * event for the page.
 */
export function coworkWriterTurn(deps: {
  request: string;
  userContext: ({ fullName?: string | null } & Record<string, unknown>) | null;
  signal: AbortSignal;
  authorize: () => Promise<void>;
  reserve: (role: 'writer' | 'reviewer') => Promise<string | undefined>;
  generate: Generate;
  recordUsage: (reservationId: string | undefined, telemetry: StructuredTelemetry) => Promise<unknown>;
  record: (event: { action: typeof COWORK_AGENT_ACTION; input: ''; result: CoworkAgentStep }) => Promise<void>;
  liveDraft: { push: (text: string) => void; review: () => void; adjust?: () => void; flush: () => Promise<void> } | null;
  timeLeft: () => number;
  models: { writer?: string; reviewer?: string };
  onCall?: (call: { model: string; durationMs: number }) => void;
}) {
  return async (brief: CoworkWriteBrief, observations: CoworkObservation[]): Promise<CoworkAnswer> => {
    const output = await runCoworkWriter({
      request: deps.request, brief, userContext: deps.userContext, observations,
      generate: async ({ role, schema, systemPrompt, prompt, stream }) => {
        const limits = CALLS[role];
        const left = deps.timeLeft();
        if (left < limits.minimumMs) throw new Error('Cowork turn time exhausted');
        deps.signal.throwIfAborted();
        await deps.authorize();
        const reservationId = await deps.reserve(role);
        const live = stream ? deps.liveDraft : null;
        // A review or a correction starts once the page knows the draft on screen is being reviewed.
        if (!stream) await deps.liveDraft?.flush();
        const call = await deps.generate({
          schema, systemPrompt, prompt, provider: 'openai', openAiModel: deps.models[role], allowDefaultModelFallback: false,
          maxAttempts: 1, timeoutMs: Math.min(limits.timeoutMs, left), maxOutputTokens: limits.maxOutputTokens, signal: deps.signal,
          onPartial: live ? text => live.push(`${LIVE_PREFIX}${text}`) : undefined,
        });
        await live?.flush();
        await deps.recordUsage(reservationId, call.telemetry);
        deps.onCall?.({ model: call.telemetry.modelName, durationMs: call.telemetry.durationMs });
        return call.data;
      },
      step: async step => {
        deps.signal.throwIfAborted();
        await deps.authorize();
        await deps.record({ action: COWORK_AGENT_ACTION, input: '', result: step });
      },
      onReview: () => deps.liveDraft?.review(),
      onAdjust: () => deps.liveDraft?.adjust?.(),
      canReview: () => deps.timeLeft() >= REVIEW_MS,
    });
    return { reply: output.reply, document: null, question: output.question, blocks: coworkWriterBlocks(output), suggestions: output.suggestions };
  };
}
