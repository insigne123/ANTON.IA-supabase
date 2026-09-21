import { getSupabaseAdminClient } from './supabase-admin';

export type ResearchGenerationStage =
  | 'synthesis_analysis'
  | 'synthesis_section'
  | 'synthesis_audit'
  | 'sequence_editorial';

export type ResearchGenerationAttemptInput = {
  organizationId: string;
  userId: string;
  researchSnapshotId: string;
  stage: ResearchGenerationStage;
  attemptNo?: number | null;
  label?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  passed?: boolean | null;
};

type SupabaseAdminLike = Pick<ReturnType<typeof getSupabaseAdminClient>, 'from'>;

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

// Same semantics as the draft usage normalizer: OpenAI bills reasoning tokens
// as completion tokens, so output_tokens already includes reasoning_tokens.
export function normalizeResearchUsage(value: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
} {
  if (!value || typeof value !== 'object') return { inputTokens: null, outputTokens: null, reasoningTokens: null };
  const record = value as Record<string, unknown>;
  const details = (record.completion_tokens_details && typeof record.completion_tokens_details === 'object'
    ? record.completion_tokens_details
    : {}) as Record<string, unknown>;
  return {
    inputTokens: nonNegative(record.prompt_tokens),
    outputTokens: nonNegative(record.completion_tokens),
    reasoningTokens: nonNegative(details.reasoning_tokens),
  };
}

// Best-effort cost telemetry. Never throws: research and drafting must proceed
// even when the telemetry insert fails.
export async function persistResearchGenerationAttempt(
  input: ResearchGenerationAttemptInput,
  client: SupabaseAdminLike = getSupabaseAdminClient(),
): Promise<void> {
  try {
    if (!input.organizationId || !input.userId || !input.researchSnapshotId || !input.stage) return;
    const { error } = await client.from('research_generation_attempts').insert({
      organization_id: input.organizationId,
      user_id: input.userId,
      research_snapshot_id: input.researchSnapshotId,
      stage: input.stage,
      attempt_no: typeof input.attemptNo === 'number' && Number.isFinite(input.attemptNo) && input.attemptNo >= 1 && input.attemptNo <= 10
        ? Math.floor(input.attemptNo)
        : 1,
      label: input.label || null,
      model: input.model || null,
      prompt_version: input.promptVersion || null,
      input_tokens: nonNegative(input.inputTokens),
      output_tokens: nonNegative(input.outputTokens),
      reasoning_tokens: nonNegative(input.reasoningTokens),
      passed: input.passed !== false,
    });
    if (error) throw error;
  } catch (error) {
    console.warn('[research-attempts] cost telemetry failed:', error);
  }
}

export type ReportV2ModelTelemetryLike = {
  phase: 'analysis' | 'section' | 'audit';
  attempt: number;
  model: string;
  usage?: Record<string, unknown> | null;
};

const SYNTHESIS_STAGE_BY_PHASE: Record<ReportV2ModelTelemetryLike['phase'], ResearchGenerationStage> = {
  analysis: 'synthesis_analysis',
  section: 'synthesis_section',
  audit: 'synthesis_audit',
};

// Funnel for synthesizeReportV2 metrics.modelTelemetry: every tracked model
// call becomes one cost row attributed to the investigation snapshot.
export async function recordReportV2ModelTelemetry(input: {
  organizationId: string;
  userId: string;
  researchSnapshotId: string;
  promptVersion?: string | null;
  modelTelemetry: ReportV2ModelTelemetryLike[] | null | undefined;
}, dependencies: { record?: typeof persistResearchGenerationAttempt } = {}): Promise<void> {
  const record = dependencies.record || persistResearchGenerationAttempt;
  for (const telemetry of input.modelTelemetry || []) {
    if (!telemetry || !SYNTHESIS_STAGE_BY_PHASE[telemetry.phase]) continue;
    const usage = normalizeResearchUsage(telemetry.usage);
    await record({
      organizationId: input.organizationId,
      userId: input.userId,
      researchSnapshotId: input.researchSnapshotId,
      stage: SYNTHESIS_STAGE_BY_PHASE[telemetry.phase],
      attemptNo: telemetry.attempt,
      model: telemetry.model || null,
      promptVersion: input.promptVersion || null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      passed: true,
    });
  }
}
