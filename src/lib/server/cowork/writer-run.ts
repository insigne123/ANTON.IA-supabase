import type { z } from 'zod';
import type { StructuredResult, StructuredTelemetry } from '@/ai/openai-json';
import type { StructuredEffort } from '@/ai/anthropic-json';
import { COWORK_AGENT_ACTION } from '@/lib/cowork/contracts';
import type { CoworkAnswer, CoworkObservation } from '@/lib/cowork/agent-loop';
import { coworkWriterBlocks, runCoworkWriter, type CoworkAgentStep, type CoworkWriteBrief } from '@/lib/cowork/writer';
import { coworkVoicePass } from '@/lib/server/cowork/writer-voice';

/** The Writer and the Reviewer write the emails of a turn (plan 2, G1). Off, the coordinator writes them as before. */
export function coworkWriterEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_WRITER_ENABLED === 'true';
}

/** The voice pass over the Writer's emails in the chat (writer-voice.ts). Off, the emails are the Writer's, as before. It needs the
 * ledger's «voice» role (migration 20261111220000); without it every reservation is refused and the emails stay as they are. */
export function coworkVoicePassEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_VOICE_PASS_ENABLED === 'true';
}

/** COWORK_WRITER_MODEL and COWORK_REVIEWER_MODEL pick their models; COWORK_MODEL by default. COWORK_WRITER_FIX_MODEL is the
 * model of the Writer's correction, the Writer's by default: one model drafts and another fixes. A «claude-» model answers
 * through Anthropic (anthropic-json.ts), any other through OpenAI. */
export function coworkWriterModels(env: Record<string, string | undefined> = process.env): CoworkWriterModels {
  const writer = env.COWORK_WRITER_MODEL || env.COWORK_MODEL;
  return { writer, reviewer: env.COWORK_REVIEWER_MODEL || env.COWORK_MODEL, fix: env.COWORK_WRITER_FIX_MODEL || writer,
    ...(env.COWORK_WRITER_SEQUENCE_MODEL ? { sequence: env.COWORK_WRITER_SEQUENCE_MODEL, sequenceFix: env.COWORK_WRITER_SEQUENCE_FIX_MODEL || undefined } : {}) };
}

export type CoworkWriterModels = { writer?: string; reviewer?: string; fix?: string; sequence?: string; sequenceFix?: string };
export type CoworkWriterEfforts = { writer?: StructuredEffort; reviewer?: StructuredEffort; fix?: StructuredEffort; sequence?: StructuredEffort };

/** The model and effort of one call. A sequence may be drafted by its own model (COWORK_WRITER_SEQUENCE_MODEL and
 * COWORK_WRITER_SEQUENCE_EFFORT), the kind of text where a stronger model pays off (12 oct reading: 4,5 against 3,25), while its
 * correction stays on the Writer's correction model unless COWORK_WRITER_SEQUENCE_FIX_MODEL says otherwise. */
export function coworkWriterCallModel(kind: 'email' | 'sequence', role: 'writer' | 'reviewer', fix: boolean | undefined,
  models: CoworkWriterModels, efforts?: CoworkWriterEfforts) {
  if (role === 'writer' && kind === 'sequence' && models.sequence) return fix
    ? { model: models.sequenceFix || models.fix || models.writer, effort: efforts?.fix }
    : { model: models.sequence, effort: efforts?.sequence ?? efforts?.writer };
  return { model: (fix && models.fix) || models[role], effort: (fix && efforts?.fix) || efforts?.[role] };
}

const EFFORTS: readonly StructuredEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
/** COWORK_WRITER_EFFORT, COWORK_REVIEWER_EFFORT and COWORK_WRITER_FIX_EFFORT (the Writer's by default): how hard each role
 * thinks. Unset or unknown, the model's usual level (low for gpt-6 and Claude), as before. */
export function coworkWriterEfforts(env: Record<string, string | undefined> = process.env): CoworkWriterEfforts {
  const pick = (value: string | undefined) => EFFORTS.find(effort => effort === String(value || '').trim().toLowerCase());
  const writer = pick(env.COWORK_WRITER_EFFORT);
  const sequence = pick(env.COWORK_WRITER_SEQUENCE_EFFORT);
  return { writer, reviewer: pick(env.COWORK_REVIEWER_EFFORT), fix: pick(env.COWORK_WRITER_FIX_EFFORT) ?? writer, ...(sequence ? { sequence } : {}) };
}

/** Each call's limits: what the ledger reserves for the role (20260928030000) and how long it may take. */
const CALLS = {
  writer: { maxOutputTokens: 6000, timeoutMs: 30_000, minimumMs: 15_000 },
  reviewer: { maxOutputTokens: 1500, timeoutMs: 15_000, minimumMs: 6_000 },
} as const;
/** One call of the voice pass: what the ledger reserves for the role (20261111220000). An email takes one, two when the first is turned back. */
const VOICE = { maxOutputTokens: 1500, timeoutMs: 15_000, minimumMs: 8_000 } as const;
/** The pass starts only with room for a call and its second try. */
const VOICE_MS = VOICE.minimumMs * 2;
/** A review and one correction take a reviewer call and a writer call. */
const REVIEW_MS = CALLS.reviewer.minimumMs + CALLS.writer.minimumMs;
/** The Writer's streamed answer, read as a coordinator answer so the live draft shows it. */
const LIVE_PREFIX = '{"action":"answer","answer":';

type Generate = <T extends z.ZodTypeAny>(options: {
  schema: T; systemPrompt: string; prompt: string; provider: 'openai'; openAiModel?: string; allowDefaultModelFallback: false;
  maxAttempts: number; timeoutMs: number; maxOutputTokens: number; signal: AbortSignal; onPartial?: (content: string) => void;
  reasoningEffort?: StructuredEffort;
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
  reserve: (role: 'writer' | 'reviewer' | 'voice') => Promise<string | undefined>;
  /** The voice pass over what the Writer wrote, and the person's own emails it takes its shape from («Tu voz»). Absent, there is none. */
  voice?: { samples: () => Promise<string[]> };
  generate: Generate;
  recordUsage: (reservationId: string | undefined, telemetry: StructuredTelemetry) => Promise<unknown>;
  record: (event: { action: typeof COWORK_AGENT_ACTION; input: ''; result: CoworkAgentStep }) => Promise<void>;
  liveDraft: { push: (text: string) => void; review: () => void; adjust?: () => void; holdFromNow?: () => void; flush: () => Promise<void> } | null;
  timeLeft: () => number;
  models: CoworkWriterModels;
  efforts?: CoworkWriterEfforts;
  onCall?: (call: { model: string; durationMs: number }) => void;
}) {
  /** Each email said again in the voice of the person who sends it, under the ledger's «voice» role. Whatever fails, the Writer's emails stand. */
  const voicePassed = async (output: Awaited<ReturnType<typeof runCoworkWriter>>, brief: CoworkWriteBrief, observations: CoworkObservation[]) => {
    if (deps.timeLeft() < VOICE_MS) return output;
    try {
      deps.liveDraft?.adjust?.();
      const chosen = coworkWriterCallModel(brief.kind, 'writer', true, deps.models, deps.efforts);
      return await coworkVoicePass(output, {
        request: deps.request, brief, userContext: deps.userContext, observations, signal: deps.signal,
        ownSamples: await deps.voice!.samples().catch(() => [] as string[]),
        hasTime: () => deps.timeLeft() >= VOICE_MS,
        generate: (async (call: { schema: z.ZodTypeAny; systemPrompt?: string; prompt: string }) => {
          const left = deps.timeLeft();
          if (left < VOICE.minimumMs) throw new Error('Cowork turn time exhausted');
          deps.signal.throwIfAborted();
          await deps.authorize();
          const reservationId = await deps.reserve('voice');
          const result = await deps.generate({
            schema: call.schema, systemPrompt: call.systemPrompt || '', prompt: call.prompt, provider: 'openai', openAiModel: chosen.model, allowDefaultModelFallback: false,
            maxAttempts: 1, timeoutMs: Math.min(VOICE.timeoutMs, left), maxOutputTokens: VOICE.maxOutputTokens, signal: deps.signal, reasoningEffort: chosen.effort,
          });
          await deps.recordUsage(reservationId, result.telemetry);
          deps.onCall?.({ model: result.telemetry.modelName, durationMs: result.telemetry.durationMs });
          return result;
        }) as never,
      });
    } catch (error) {
      if (deps.signal.aborted) throw error;
      return output;
    }
  };
  return async (brief: CoworkWriteBrief, observations: CoworkObservation[]): Promise<CoworkAnswer> => {
    // The Reviewer often changes the emails (7 of the 10 written in production between 1 and 20 Oct): they show once, when final.
    deps.liveDraft?.holdFromNow?.();
    const output = await runCoworkWriter({
      request: deps.request, brief, userContext: deps.userContext, observations, now: new Date(),
      generate: async ({ role, schema, systemPrompt, prompt, stream, fix }) => {
        const limits = CALLS[role];
        const left = deps.timeLeft();
        if (left < limits.minimumMs) throw new Error('Cowork turn time exhausted');
        deps.signal.throwIfAborted();
        await deps.authorize();
        const reservationId = await deps.reserve(role);
        const live = stream ? deps.liveDraft : null;
        // A review or a correction starts once the page knows the draft on screen is being reviewed.
        if (!stream) await deps.liveDraft?.flush();
        const chosen = coworkWriterCallModel(brief.kind, role, fix, deps.models, deps.efforts);
        const call = await deps.generate({
          schema, systemPrompt, prompt, provider: 'openai', openAiModel: chosen.model, allowDefaultModelFallback: false,
          maxAttempts: 1, timeoutMs: Math.min(limits.timeoutMs, left), maxOutputTokens: limits.maxOutputTokens, signal: deps.signal,
          reasoningEffort: chosen.effort,
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
    const voiced = deps.voice ? await voicePassed(output, brief, observations) : output;
    return { reply: voiced.reply, document: null, question: voiced.question, blocks: coworkWriterBlocks(voiced), suggestions: voiced.suggestions };
  };
}
