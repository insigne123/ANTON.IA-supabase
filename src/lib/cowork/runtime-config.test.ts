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
