import { isBlockedModel } from '@/ai/blocked-models';

/** Cowork does not inherit SUPLIA_AI_PROVIDER or AI_PROVIDER. */
export function resolveCoworkRuntime(environment: Record<string, string | undefined>) {
  const worker = environment.COWORK_WORKER_ENABLED === 'true' && Boolean(environment.COWORK_WORKER_SECRET?.trim());
  // COWORK_RUNTIME=harness: the coordinator is a Claude (harness-turn.ts), so it needs the Anthropic key and no OpenAI model.
  // A coordinator of an expensive tier is not run (src/ai/blocked-models.ts): the runtime below answers, as with the harness off.
  if (environment.COWORK_RUNTIME?.trim() === 'harness') {
    const model = environment.COWORK_HARNESS_MODEL?.trim() || 'claude-sonnet-5-5';
    if (!isBlockedModel(model)) return { ready: worker && Boolean(environment.ANTHROPIC_API_KEY?.trim()), provider: 'anthropic' as const, model };
  }
  const model = environment.COWORK_MODEL?.trim() || '';
  const provider = environment.COWORK_PROVIDER?.trim() || 'openai';
  const ready = worker && provider === 'openai' && Boolean(model) && Boolean(environment.OPENAI_API_KEY?.trim());
  return { ready, provider: 'openai' as const, model };
}
