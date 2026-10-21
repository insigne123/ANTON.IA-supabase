import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCoworkRuntime } from './runtime-config';

test('Cowork rejects incomplete configuration and ignores legacy provider selection', () => {
  const configured = { COWORK_WORKER_ENABLED: 'true', COWORK_WORKER_SECRET: 'test-secret', COWORK_MODEL: 'test-model', OPENAI_API_KEY: 'test-key', AI_PROVIDER: 'glm', SUPLIA_AI_PROVIDER: 'glm' };
  assert.deepEqual(resolveCoworkRuntime(configured), { ready: true, provider: 'openai', model: 'test-model' });
  for (const key of ['COWORK_WORKER_ENABLED', 'COWORK_WORKER_SECRET', 'COWORK_MODEL', 'OPENAI_API_KEY']) {
    assert.equal(resolveCoworkRuntime({ ...configured, [key]: '' }).ready, false);
  }
  assert.equal(resolveCoworkRuntime({ ...configured, COWORK_PROVIDER: 'glm' }).ready, false);
});

test('the harness runtime needs the Anthropic key and a worker, and no OpenAI model', () => {
  const harness = { COWORK_WORKER_ENABLED: 'true', COWORK_WORKER_SECRET: 'test-secret', COWORK_RUNTIME: 'harness', ANTHROPIC_API_KEY: 'test-key' };
  assert.deepEqual(resolveCoworkRuntime(harness), { ready: true, provider: 'anthropic', model: 'claude-sonnet-5-5' });
  assert.deepEqual(resolveCoworkRuntime({ ...harness, COWORK_HARNESS_MODEL: 'claude-haiku-5-5' }), { ready: true, provider: 'anthropic', model: 'claude-haiku-5-5' });
  for (const key of ['COWORK_WORKER_ENABLED', 'COWORK_WORKER_SECRET', 'ANTHROPIC_API_KEY']) {
    assert.equal(resolveCoworkRuntime({ ...harness, [key]: '' }).ready, false);
  }
  assert.equal(resolveCoworkRuntime({ ...harness, COWORK_RUNTIME: 'openai', COWORK_MODEL: 'm' }).ready, false);
});
