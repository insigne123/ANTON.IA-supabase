import assert from 'node:assert/strict';
import test from 'node:test';
import { blockedModelMessage, isBlockedModel } from './blocked-models';

test('the expensive tiers of both providers are blocked, in any spelling', () => {
  for (const model of ['claude-opus-5-5', 'Claude-Opus-5-5', 'claude-fable-5-1', 'gpt-6-sol', 'gpt-6.1-sol', 'GPT-6-SOL', ' gpt-5.6-sol ',
    'gpt-5.6-terra', 'gpt-6-astra', 'gpt-5.6-astra', 'opus']) {
    assert.equal(isBlockedModel(model), true, model);
  }
});

test('Luna, Haiku and Sonnet are not, nor words that only contain the letters', () => {
  for (const model of ['gpt-6-luna', 'gpt-5.6-luna', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'gpt-4o-mini-transcribe', 'glm-5.2',
    'primary-model', 'test-model', 'isolated', '', null, undefined]) {
    assert.equal(isBlockedModel(model), false, String(model));
  }
});

test('the refusal names the model', () => {
  assert.equal(blockedModelMessage('claude-opus-5-5'), 'El modelo claude-opus-5-5 no está permitido en ANTON.IA.');
});
