import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOpenAiTelemetry, estimateOpenAiCostUsd, normalizeOpenAiUsage } from './suplia-observability';

test('normalizes OpenAI usage fields', () => {
  assert.deepEqual(normalizeOpenAiUsage({ prompt_tokens: 1000, completion_tokens: 500 }), {
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
  });
});

test('estimates model cost when pricing is known', () => {
  assert.equal(estimateOpenAiCostUsd('gpt-4o-mini', { prompt_tokens: 1000, completion_tokens: 1000 }), 0.00075);
  assert.equal(estimateOpenAiCostUsd('unknown', { prompt_tokens: 1000, completion_tokens: 1000 }), null);
});

test('builds telemetry payload for agent runs', () => {
  assert.deepEqual(buildOpenAiTelemetry({ modelTier: 'reasoning', modelName: 'gpt-4o-mini', usage: { prompt_tokens: 1000, completion_tokens: 0 }, durationMs: 42 }), {
    modelTier: 'reasoning',
    modelName: 'gpt-4o-mini',
    tokenUsage: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000 },
    estimatedCost: 0.00015,
    durationMs: 42,
  });
});
