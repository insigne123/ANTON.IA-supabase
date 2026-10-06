import type { StructuredResult, StructuredTelemetry } from '@/ai/openai-json';
import { COWORK_AGENT_ACTION } from '@/lib/cowork/contracts';
import type { CoworkAnswer, CoworkObservation } from '@/lib/cowork/agent-loop';
import type { CoworkAgentStep } from '@/lib/cowork/writer';
import {
  coworkArtifactFileName, coworkArtifactFileParts, coworkArtifactKey,
  type CoworkArtifactTableName, type CoworkCodeArtifactPayload, type CoworkDesignBrief,
} from '@/lib/cowork/design-brief';
import type { CoworkArtifactData, CoworkCodeArtifact } from './code-artifact';
import { coworkDesignerOutputSchema, runCoworkDesigner } from './designer';

/** Code artifacts (Plan 12, 3b): the coordinator may hand a brief to the Designer. Off, artifact.create does not exist. */
export function coworkCodeArtifactsEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_CODE_ARTIFACTS_ENABLED === 'true';
}

/** COWORK_DESIGNER_MODEL picks the Designer's model; COWORK_WRITER_MODEL, then COWORK_MODEL by default. */
export function coworkDesignerModel(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_DESIGNER_MODEL || env.COWORK_WRITER_MODEL || env.COWORK_MODEL;
}

/** The Designer's call: the writer role of the ledger (6,000 output tokens), and at least this much time left. */
const CALL = { maxOutputTokens: 6000, timeoutMs: 60_000, minimumMs: 20_000 } as const;

type Generate = (options: {
  schema: typeof coworkDesignerOutputSchema; systemPrompt: string; prompt: string; provider: 'openai'; openAiModel?: string; allowDefaultModelFallback: false;
  maxAttempts: number; timeoutMs: number; maxOutputTokens: number; signal: AbortSignal;
}) => Promise<StructuredResult<typeof coworkDesignerOutputSchema>>;

/** Where an artifact is kept and how it is found again (the worker gives Supabase; the corpus, memory). */
export type CoworkArtifactStore = {
  loadData: (tables: CoworkArtifactTableName[]) => Promise<CoworkArtifactData>;
  /** The code of an artifact made before in this person's conversations, by file name; null when it is not theirs or not found. */
  loadPrevious: (name: string) => Promise<CoworkCodeArtifact | null>;
  /** The next version for a key (1 for a new artifact). */
  nextVersion: (key: string) => Promise<number>;
  /** Keeps the page and its code; returns where the page went. */
  save: (file: { name: string; html: string; code: CoworkCodeArtifact }) => Promise<{ path: string; size: number }>;
  /** Records the artifact.created event of the run. */
  recordArtifact: (payload: CoworkCodeArtifactPayload) => Promise<void>;
};

/**
 * The worker's `design` for runCoworkReadLoop: reads the tables of the brief, has the Designer write the
 * artifact (one correction at most, if time allows), keeps it as a file of the run and returns the turn's
 * answer. Each model call reserves the writer role and records its usage; each step shows on the page.
 */
export function coworkDesignerTurn(deps: {
  request: string;
  userContext: unknown;
  signal: AbortSignal;
  authorize: () => Promise<void>;
  reserve: (role: 'writer') => Promise<string | undefined>;
  generate: Generate;
  recordUsage: (reservationId: string | undefined, telemetry: StructuredTelemetry) => Promise<unknown>;
  record: (event: { action: typeof COWORK_AGENT_ACTION; input: ''; result: CoworkAgentStep }) => Promise<void>;
  timeLeft: () => number;
  model?: string;
  store: CoworkArtifactStore;
  now?: () => Date;
  onCall?: (call: { model: string; durationMs: number }) => void;
}) {
  const step = async (result: CoworkAgentStep) => {
    deps.signal.throwIfAborted();
    await deps.authorize();
    await deps.record({ action: COWORK_AGENT_ACTION, input: '', result });
  };
  return async (brief: CoworkDesignBrief, _observations: CoworkObservation[]): Promise<CoworkAnswer> => {
    const previousParts = brief.previous ? coworkArtifactFileParts(brief.previous) : null;
    const previous = brief.previous ? await deps.store.loadPrevious(brief.previous) : null;
    if (brief.previous && !previous) throw new Error(`No encontré el artefacto ${brief.previous} en tus conversaciones.`);
    await step({ agent: 'designer', state: 'working', label: previous ? `Cambiando «${brief.title}»` : `Diseñando «${brief.title}»` });
    const data = await deps.store.loadData(brief.tables);
    const result = await runCoworkDesigner({
      brief, request: deps.request, data, previous, userContext: deps.userContext, generatedAt: (deps.now?.() ?? new Date()).toISOString(),
      canRetry: () => deps.timeLeft() >= CALL.minimumMs,
      generate: async ({ systemPrompt, prompt, attempt }) => {
        const left = deps.timeLeft();
        if (left < CALL.minimumMs) throw new Error('Cowork turn time exhausted');
        deps.signal.throwIfAborted();
        await deps.authorize();
        if (attempt === 2) await step({ agent: 'designer', state: 'working', label: 'Corrigiendo el código del artefacto' });
        const reservationId = await deps.reserve('writer');
        const call = await deps.generate({
          schema: coworkDesignerOutputSchema, systemPrompt, prompt, provider: 'openai', openAiModel: deps.model, allowDefaultModelFallback: false,
          maxAttempts: 1, timeoutMs: Math.min(CALL.timeoutMs, left - 5_000), maxOutputTokens: CALL.maxOutputTokens, signal: deps.signal,
        });
        await deps.recordUsage(reservationId, call.telemetry);
        deps.onCall?.({ model: call.telemetry.modelName, durationMs: call.telemetry.durationMs });
        return call.data;
      },
    });
    const key = previousParts?.key ?? coworkArtifactKey(result.output.title);
    const version = await deps.store.nextVersion(key);
    const name = coworkArtifactFileName(key, version);
    const saved = await deps.store.save({ name, html: result.html, code: { html: result.output.html, css: result.output.css, js: result.output.js } });
    await deps.store.recordArtifact({
      name, path: saved.path, size: saved.size, kind: 'code', title: result.output.title, key, version,
      tables: Object.entries(data.tables).map(([table, value]) => ({ name: table as CoworkArtifactTableName, label: value.label, rows: value.total, truncated: value.truncated })),
    });
    await step({ agent: 'designer', state: 'done', label: `${version > 1 ? `Versión ${version} de` : 'Listo:'} «${result.output.title}»` });
    return { reply: result.output.reply, document: null, blocks: null, question: result.output.question, suggestions: result.output.suggestions };
  };
}
