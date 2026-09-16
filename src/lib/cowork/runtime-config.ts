/** Cowork does not inherit SUPLIA_AI_PROVIDER or AI_PROVIDER. */
export function resolveCoworkRuntime(environment: Record<string, string | undefined>) {
  const model = environment.COWORK_MODEL?.trim() || '';
  const provider = environment.COWORK_PROVIDER?.trim() || 'openai';
  const ready = environment.COWORK_WORKER_ENABLED === 'true'
    && provider === 'openai' && Boolean(model)
    && Boolean(environment.COWORK_WORKER_SECRET?.trim())
    && Boolean(environment.OPENAI_API_KEY?.trim());
  return { ready, provider: 'openai' as const, model };
}
