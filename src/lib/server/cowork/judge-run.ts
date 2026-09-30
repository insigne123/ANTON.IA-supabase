import type { z } from 'zod';
import type { StructuredResult, StructuredTelemetry } from '@/ai/openai-json';
import { COWORK_AGENT_ACTION } from '@/lib/cowork/contracts';
import type { CoworkAnswer, CoworkObservation } from '@/lib/cowork/agent-loop';
import type { CoworkCorrectionVerdict } from '@/lib/cowork/correction-guard';
import { coworkJudgeFix, coworkJudgeInstructions, coworkJudgeSchema, coworkJudgeTurnPrompt, type CoworkJudgement } from '@/lib/cowork/judge';
import {
  COWORK_JEV_DEFAULT_SCREEN, COWORK_JEV_DEFAULT_THRESHOLDS, COWORK_JEV_QUESTIONS, coworkJevJudgement, coworkJevProbabilities, coworkJevSeen,
  coworkJevStateFromPrompt, type CoworkJevThresholds,
} from '@/lib/cowork/jev-review';
import { COWORK_JEV_TURN_TIMEOUT_MS, type CoworkReviewEngine } from '@/lib/cowork/review-engine';
import type { CoworkAgentStep } from '@/lib/cowork/writer';
import type { JevResult } from '@/lib/server/jev';

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
/** Held (COWORK_ANSWER_HOLD_ENABLED), the person waits for the review before reading anything: it gets less time. */
export const COWORK_JUDGE_HELD_TIMEOUT_MS = 8_000;
/** The coordinator's correction after the judge (a decision may take 30 s) fits before the deadline too. */
const CORRECTION_MS = 30_000;

type Generate = <T extends z.ZodTypeAny>(options: {
  schema: T; systemPrompt: string; prompt: string; provider: 'openai'; openAiModel?: string; allowDefaultModelFallback: false;
  maxAttempts: number; timeoutMs: number; maxOutputTokens: number; signal: AbortSignal;
}) => Promise<StructuredResult<T>>;

/** Jev's question call (askJev), injected: a turn never reaches TypeSafe unless the worker hands it this. */
export type AskJev = (input: { state: unknown; questions: typeof COWORK_JEV_QUESTIONS; timeoutMs: number; signal: AbortSignal }) => Promise<JevResult>;

/** What Jev said, as it is kept with a step for whoever reviews the turn later: never the state it read, never the key. */
function jevDetail(result: JevResult | null, extra: Record<string, unknown> = {}) {
  if (!result) return { status: 'error', ...extra };
  return {
    status: result.status, model: result.model, durationMs: result.durationMs, inputTokens: result.inputTokens, costUsd: result.costUsd,
    probabilities: result.answers ? coworkJevProbabilities(result.answers) : null, ...extra,
  };
}

/**
 * The worker's judge for runCoworkReadLoop, under the run's lease: `review` reads
 * the coordinator's final answer and returns what to fix, or null when it stands
 * (clean, no time, or the call failed); `corrected` receives whether the loop kept the
 * correction (coworkCorrectionVerdict); `finish` records how the correction ended once the
 * loop returns. The call reserves the `judge` role in the ledger, records its usage and fits
 * in the time the turn has left. Each step is recorded as an event for the page, where the
 * judge shows as the Reviewer; its verdict step keeps what it found (detail) for whoever
 * reviews the turn later.
 *
 * Who reads the answer is `engine` (COWORK_REVIEW_ENGINE, review-engine.ts): the model (llm, the default), Jev alone (jev), Jev first and
 * the model only when Jev sees something or does not answer (jev-llm), or nobody (off). Jev answers questions, it does not write: its
 * fired questions become a regular judgement, so what the coordinator is asked and how the correction is kept is the same path. Jev
 * fails open: without a key, late or unreadable, the answer goes out as it is (jev) or to the model (jev-llm). With `jevShadow` Jev
 * answers next to the review (or alone, when nobody reviews) and only records, in a step the page ignores.
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
  /** How long its call may take (COWORK_JUDGE_HELD_TIMEOUT_MS when the answer is held). */
  callTimeoutMs?: number;
  onCall?: (call: { model: string; durationMs: number }) => void;
  /** Who reviews (COWORK_REVIEW_ENGINE). The model by default. */
  engine?: CoworkReviewEngine;
  /** Jev's question call; without it nothing asks Jev, whatever the engine says. */
  jev?: AskJev;
  /** COWORK_JEV_SHADOW: Jev answers next to the review and only records. */
  jevShadow?: boolean;
  /** The probability at or above which a question asks for a correction (docs/cowork-jev.md), and the lower one that calls the model in jev-llm. */
  jevThresholds?: CoworkJevThresholds;
  jevScreen?: CoworkJevThresholds;
  jevTimeoutMs?: number;
}) {
  const callMs = deps.callTimeoutMs ?? CALL.timeoutMs;
  const jevMs = deps.jevTimeoutMs ?? COWORK_JEV_TURN_TIMEOUT_MS;
  const engine = deps.engine ?? 'llm';
  const decides = engine === 'jev' || engine === 'jev-llm';
  const watches = deps.jevShadow === true && Boolean(deps.jev) && !decides;
  // The judge's call and the correction after it fit before the deadline.
  const reviewMs = (engine === 'jev' ? jevMs : engine === 'jev-llm' ? jevMs + callMs : callMs) + CORRECTION_MS;
  // The answer the judge asked to fix: the loop returns it unchanged when the correction fails.
  let asked: CoworkAnswer | null = null;
  let verdict: CoworkCorrectionVerdict | null = null;
  const step = async (result: CoworkAgentStep) => {
    deps.signal.throwIfAborted();
    await deps.authorize();
    await deps.record({ action: COWORK_AGENT_ACTION, input: '', result });
  };
  /** Jev's answers to the questions about this prompt, or null when it could not be asked (it fails open). */
  const askJev = async (prompt: string, timeoutMs: number): Promise<JevResult | null> => {
    if (!deps.jev) return null;
    try {
      return await deps.jev({ state: coworkJevStateFromPrompt(prompt), questions: COWORK_JEV_QUESTIONS, timeoutMs, signal: deps.signal });
    } catch (error) {
      if (deps.signal.aborted) throw error;
      return null;
    }
  };
  /** What Jev said next to a review, kept in a step of its own that the page ignores (it only knows the Writer, the Reviewer and the judge). */
  const watch = async (result: JevResult | null) => {
    const thresholds = deps.jevThresholds ?? COWORK_JEV_DEFAULT_THRESHOLDS;
    const judgement = result?.status === 'ok' ? coworkJevJudgement(result.answers, thresholds) : null;
    await step({ agent: 'jev', state: 'done', label: 'Jev en sombra', changes: [],
      detail: { engine: 'jev', shadow: true, ...jevDetail(result, { fired: judgement?.fired ?? [], thresholds }) } });
  };
  return {
    review: async (answer: CoworkAnswer, observations: CoworkObservation[], turn: { canRead: boolean } = { canRead: true }): Promise<string | null> => {
      if (engine === 'off') {
        // Nobody reviews: Jev, if it watches, answers without touching the page or the answer.
        if (!watches || deps.timeLeft() < jevMs) return null;
        try {
          const prompt = coworkJudgeTurnPrompt({ request: deps.request, history: deps.history, userContext: deps.userContext, observations, answer });
          await watch(await askJev(prompt, Math.min(jevMs, deps.timeLeft())));
        } catch (error) {
          if (deps.signal.aborted) throw error;
        }
        return null;
      }
      if (deps.timeLeft() < reviewMs) return null;
      await step({ agent: 'judge', state: 'working', label: 'Revisando la respuesta' });
      // The text on screen stays, marked as being reviewed, until the final answer replaces it
      // (held, nothing was on screen: the page says the answer is being reviewed).
      deps.liveDraft?.review();
      let judgement: CoworkJudgement | null = null;
      let durationMs = 0;
      let model: string | null = deps.model ?? null;
      let jev: JevResult | null = null;
      let jevFired: string[] = [];
      let shadow: Promise<JevResult | null> | null = null;
      // Who read it in the end: the model, Jev (alone), Jev clearing it (jev-llm), or nobody.
      let reader: 'model' | 'jev' | 'cleared' | 'nobody' = 'model';
      try {
        await deps.liveDraft?.flush();
        const prompt = coworkJudgeTurnPrompt({ request: deps.request, history: deps.history, userContext: deps.userContext, observations, answer });
        // With the model in charge, a shadow Jev answers while it thinks: it adds no wait.
        if (watches && engine === 'llm') shadow = askJev(prompt, jevMs).catch(() => null);
        if (decides) {
          jev = await askJev(prompt, Math.min(jevMs, deps.timeLeft()));
          if (engine === 'jev') {
            const jevJudgement = jev?.status === 'ok' ? coworkJevJudgement(jev.answers, deps.jevThresholds ?? COWORK_JEV_DEFAULT_THRESHOLDS) : null;
            if (jevJudgement) { judgement = jevJudgement; jevFired = jevJudgement.fired; durationMs = jev?.durationMs ?? 0; model = jev?.model ?? null; reader = 'jev'; }
            else reader = 'nobody';
          } else if (jev?.status === 'ok' && !coworkJevSeen(jev.answers, deps.jevScreen ?? COWORK_JEV_DEFAULT_SCREEN).length) {
            // Jev clears it: the model does not need to read it.
            reader = 'cleared';
          }
        }
        if (reader === 'model') {
          const reservationId = await deps.reserve();
          const call = await deps.generate({
            schema: coworkJudgeSchema, systemPrompt: coworkJudgeInstructions({ contactsImport: deps.contactsImport, inTurn: true }), prompt,
            provider: 'openai', openAiModel: deps.model, allowDefaultModelFallback: false, maxAttempts: 1,
            timeoutMs: Math.min(callMs, deps.timeLeft()), maxOutputTokens: CALL.maxOutputTokens, signal: deps.signal,
          });
          await deps.recordUsage(reservationId, call.telemetry);
          deps.onCall?.({ model: call.telemetry.modelName, durationMs: call.telemetry.durationMs });
          durationMs = call.telemetry.durationMs;
          judgement = call.data;
        }
      } catch (error) {
        if (deps.signal.aborted) throw error;
        // Without a verdict the answer goes out as it is.
        reader = 'nobody';
        judgement = null;
      }
      if (shadow) await watch(await shadow);
      const jevPart = decides ? { jev: jevDetail(jev, { fired: jevFired }) } : {};
      if (!judgement) {
        if (reader === 'cleared') {
          await step({ agent: 'judge', state: 'done', label: 'Sin ajustes', outcome: 'clean', changes: [],
            detail: { engine, model: jev?.model ?? null, durationMs: jev?.durationMs ?? 0, canRead: turn.canRead, asked: false, llm: false, ...jevPart } });
        } else {
          await step({ agent: 'judge', state: 'done', label: 'No alcanzó a revisar', outcome: 'skipped', changes: [],
            ...(decides ? { detail: { engine, canRead: turn.canRead, asked: false, ...jevPart } } : {}) });
        }
        return null;
      }
      const fix = coworkJudgeFix(judgement, { canRead: turn.canRead, question: answer.question });
      const detail = { engine, model, durationMs, canRead: turn.canRead, asked: Boolean(fix),
        scores: judgement.scores, problemas: judgement.problemas, veredicto: judgement.veredicto, ...jevPart };
      if (!fix) {
        await step({ agent: 'judge', state: 'done', label: 'Sin ajustes', outcome: 'clean', changes: [], detail });
        return null;
      }
      asked = answer;
      verdict = null;
      await step({ agent: 'judge', state: 'working', label: 'Ajustando la respuesta', detail });
      return fix;
    },
    /** Whether the loop kept the correction: a correction that is not one leaves the first answer. */
    corrected: (result: CoworkCorrectionVerdict) => { verdict = result; },
    /** After the loop (or when it failed, with null). The loop's verdict says whether the correction
     * was kept. Without one (the correction became the Writer's emails or a proposal, or it failed and
     * the judged answer stood) it was kept when the reply changed: the charts step returns a new
     * object for the same answer, so comparing objects would count a failed correction as made. */
    finish: async (result: unknown) => {
      if (!asked) return;
      const reply = result && typeof result === 'object' ? (result as { reply?: unknown }).reply : null;
      const fixed = verdict ? verdict.keep === 'correction' : typeof reply === 'string' && reply !== asked.reply;
      const reason = verdict?.reason ?? null;
      asked = null;
      verdict = null;
      await step(fixed
        ? { agent: 'judge', state: 'done', label: 'Ajustó la respuesta', outcome: 'fixed', changes: [], detail: { kept: 'correction' } }
        : { agent: 'judge', state: 'done', label: reason === 'new_figures' || reason === 'unchanged' ? 'Dejó la primera respuesta' : 'No alcanzó a ajustarla',
          outcome: 'skipped', changes: [], detail: { kept: 'first', reason } });
    },
  };
}
