import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThreadKey, deriveLifecycleState } from './email-observability';

test('buildThreadKey prioritizes provider-native threading ids', () => {
  assert.equal(buildThreadKey({ provider: 'gmail', threadId: 'thr_123', messageId: 'm1' }), 'gmail:thr_123');
  assert.equal(buildThreadKey({ provider: 'outlook', conversationId: 'conv_123', internetMessageId: '<abc@x>' }), 'outlook:conv_123');
});

test('deriveLifecycleState advances to reply and bounce correctly', () => {
  assert.equal(deriveLifecycleState('sent', 'open'), 'opened');
  assert.equal(deriveLifecycleState('opened', 'click'), 'clicked');
  assert.equal(deriveLifecycleState('clicked', 'reply'), 'replied');
  assert.equal(deriveLifecycleState('opened', 'bounce'), 'bounced');
});
