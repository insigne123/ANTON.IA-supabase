import type { StructuredResult, StructuredTelemetry } from '@/ai/openai-json';
import { COWORK_AGENT_ACTION } from '@/lib/cowork/contracts';
import type { CoworkAnswer, CoworkObservation } from '@/lib/cowork/agent-loop';
import type { CoworkAgentStep } from '@/lib/cowork/writer';
import { COWORK_ANALYST_RULES, coworkAnalystAnswer, coworkAnalystOutputSchema, coworkAnalystPrompt, type CoworkAnalysisBrief } from '@/lib/cowork/analyst';

/** The Analyst (Plan 12, 4b): the coordinator may hand a question about results to it. Off, analysis.write does not exist. */
export function coworkAnalystEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_ANALYST_ENABLED === 'true';
}

/** COWORK_ANALYST_MODEL picks the Analyst's model; COWORK_MODEL by default. */
export function coworkAnalystModel(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_ANALYST_MODEL || env.COWORK_MODEL;
}

/** The Analyst's call: the writer role of the ledger (the Analyst and the Writer never share a turn), and at least this much time left. */
const CALL = { maxOutputTokens: 4000, timeoutMs: 40_000, minimumMs: 15_000 } as const;
/** The Analyst's streamed answer, read as a coordinator answer so the live draft shows it. */
const LIVE_PREFIX = '{"action":"answer","answer":';

type Generate = (options: {
  schema: typeof coworkAnalystOutputSchema; systemPrompt: string; prompt: string; provider: 'openai'; openAiModel?: string; allowDefaultModelFallback: false;
  maxAttempts: number; timeoutMs: number; maxOutputTokens: number; signal: AbortSignal; onPartial?: (content: string) => void;
}) => Promise<StructuredResult<typeof coworkAnalystOutputSchema>>;

/**
 * The worker's `analyze` for runCoworkReadLoop: one call to the Analyst with what the turn read, streamed into the
 * live draft, under the run's lease. It reserves the writer role and records its usage; its steps show on the page.
 */
export function coworkAnalystTurn(deps: {
  request: string;
  userContext: unknown;
  history: Array<{ at?: unknown; request?: unknown; reply?: unknown }>;
  signal: AbortSignal;
  authorize: () => Promise<void>;
  reserve: (role: 'writer') => Promise<string | undefined>;
  generate: Generate;
  recordUsage: (reservationId: string | undefined, telemetry: StructuredTelemetry) => Promise<unknown>;
  record: (event: { action: typeof COWORK_AGENT_ACTION; input: ''; result: CoworkAgentStep }) => Promise<void>;
  liveDraft: { push: (text: string) => void; flush: () => Promise<void> } | null;
  timeLeft: () => number;
  timeZone: string;
  model?: string;
  now?: () => Date;
  onCall?: (call: { model: string; durationMs: number }) => void;
}) {
  const step = async (result: CoworkAgentStep) => {
    deps.signal.throwIfAborted();
    await deps.authorize();
    await deps.record({ action: COWORK_AGENT_ACTION, input: '', result });
  };
  return async (brief: CoworkAnalysisBrief, observations: CoworkObservation[]): Promise<CoworkAnswer> => {
    const left = deps.timeLeft();
    if (left < CALL.minimumMs) throw new Error('Cowork turn time exhausted');
    await step({ agent: 'analyst', state: 'working', label: 'Analizando tus cifras' });
    const reservationId = await deps.reserve('writer');
    const live = deps.liveDraft;
    const call = await deps.generate({
      schema: coworkAnalystOutputSchema, systemPrompt: COWORK_ANALYST_RULES.join('\n'),
      prompt: coworkAnalystPrompt({ request: deps.request, brief, userContext: deps.userContext, observations, history: deps.history,
        now: deps.now?.() ?? new Date(), timeZone: deps.timeZone }),
      provider: 'openai', openAiModel: deps.model, allowDefaultModelFallback: false,
      maxAttempts: 1, timeoutMs: Math.min(CALL.timeoutMs, left - 5_000), maxOutputTokens: CALL.maxOutputTokens, signal: deps.signal,
      onPartial: live ? text => live.push(`${LIVE_PREFIX}${text}`) : undefined,
    });
    await live?.flush();
    await deps.recordUsage(reservationId, call.telemetry);
    deps.onCall?.({ model: call.telemetry.modelName, durationMs: call.telemetry.durationMs });
    await step({ agent: 'analyst', state: 'done', label: 'Análisis listo' });
    return coworkAnalystAnswer(call.data);
  };
}
