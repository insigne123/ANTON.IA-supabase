import type { OpenAiModelTier } from '@/ai/model-router';

export type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

const MODEL_COSTS_USD_PER_1K: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-5.4-nano': { input: 0.00005, output: 0.0002 },
  'gpt-5.4-mini': { input: 0.00015, output: 0.0006 },
  'gpt-5.4': { input: 0.001, output: 0.004 },
  'gpt-5.5': { input: 0.002, output: 0.008 },
};

export function normalizeOpenAiUsage(usage?: OpenAiUsage | null) {
  if (!usage) return null;
  const promptTokens = Number(usage.prompt_tokens ?? usage.promptTokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? usage.completionTokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? promptTokens + completionTokens);
  return {
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
  };
}

export function estimateOpenAiCostUsd(modelName?: string | null, usage?: OpenAiUsage | null) {
  const normalized = normalizeOpenAiUsage(usage);
  if (!normalized || !modelName) return null;
  const model = MODEL_COSTS_USD_PER_1K[modelName] || MODEL_COSTS_USD_PER_1K[modelName.toLowerCase()];
  if (!model) return null;
  return Number((((normalized.promptTokens / 1000) * model.input) + ((normalized.completionTokens / 1000) * model.output)).toFixed(8));
}

export function buildOpenAiTelemetry(input: { modelTier?: OpenAiModelTier | null; modelName?: string | null; usage?: OpenAiUsage | null; durationMs?: number | null }) {
  const usage = normalizeOpenAiUsage(input.usage);
  return {
    modelTier: input.modelTier || null,
    modelName: input.modelName || null,
    tokenUsage: usage,
    estimatedCost: estimateOpenAiCostUsd(input.modelName, input.usage),
    durationMs: input.durationMs ?? null,
  };
}
