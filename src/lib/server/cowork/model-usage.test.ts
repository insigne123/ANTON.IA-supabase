import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkModelUsage } from './model-usage';

test('usage preserves unknown quantities and does not invent model pricing', () => {
  const usage = coworkModelUsage({ modelName: 'unknown', durationMs: 12 });
  assert.equal(usage.inputTokens, null); assert.equal(usage.costUsd, null);
  assert.equal(usage.pricing, null);
});
test('known usage computes cost with explicit cached-input price and version', () => {
  const pricing = JSON.stringify({ exact: { version: '2026-09', inputUsdPerMillion: 2, outputUsdPerMillion: 8, cachedInputUsdPerMillion: 1 } });
  const telemetry = { modelName: 'exact', durationMs: 12, usage: { prompt_tokens: 1000, completion_tokens: 100,
    total_tokens: 1100, prompt_tokens_details: { cached_tokens: 200 } } };
  assert.equal(coworkModelUsage(telemetry, pricing).costUsd, 0.0026);
  assert.equal(coworkModelUsage({ ...telemetry, modelName: 'other' }, pricing).costUsd, null);
  assert.equal(coworkModelUsage({ ...telemetry, usage: { prompt_tokens: 1000, completion_tokens: 100 } }, pricing).costUsd, null);
  assert.equal(coworkModelUsage(telemetry, 'invalid').costUsd, null);
});
