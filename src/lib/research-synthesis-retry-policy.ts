export const SYNTHESIS_EDITORIAL_RETRY_LIMIT = 1;

export type SynthesisRetryPolicy = {
  retryable: boolean;
  shouldExposeTask: boolean;
};

export function resolveSynthesisRetryPolicy(input: {
  attemptCount?: number | null;
  retryable?: boolean;
}): SynthesisRetryPolicy {
  if (input.retryable !== true) return { retryable: false, shouldExposeTask: true };
  const attempts = Math.max(0, Math.trunc(Number(input.attemptCount) || 0));
  if (attempts > SYNTHESIS_EDITORIAL_RETRY_LIMIT) return { retryable: false, shouldExposeTask: true };
  return { retryable: true, shouldExposeTask: false };
}

export type SynthesisActionableTask = {
  kind: 'synthesis_retry_exhausted' | 'synthesis_input_invalid';
  title: string;
  detail: string;
  howToFind: string;
  researchSnapshotId: string;
};

export function buildSynthesisActionableTask(input: {
  researchSnapshotId: string;
  errorCode: string;
  missingFields?: string[];
}): SynthesisActionableTask {
  const missing = (input.missingFields || []).filter(Boolean);
  const retryExhausted = input.errorCode !== 'research_report_candidate_invalid';
  return {
    kind: retryExhausted ? 'synthesis_retry_exhausted' : 'synthesis_input_invalid',
    title: retryExhausted
      ? 'Reintento editorial agotado: completa la evidencia y relanza'
      : 'La síntesis no puede generarse con estos datos',
    detail: retryExhausted
      ? `La síntesis ya usó su reintento editorial. En lugar de repetir llamadas costosas al modelo, completa la evidencia pendiente${missing.length > 0 ? ` (${missing.slice(0, 3).join(', ')})` : ''} y relanza la síntesis.`
      : 'La validación factual rechazó la síntesis. Revisa los datos de entrada antes de relanzar.',
    howToFind: 'Revisa las fuentes citadas, agrega evidencia con fecha y vuelve a poner la síntesis en cola.',
    researchSnapshotId: input.researchSnapshotId,
  };
}
