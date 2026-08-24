import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThreadKey, deriveLifecycleState, safeInsertEmailEvent } from './email-observability';

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

test('safe event insertion reuses the canonical sent event for a dispatch replay', async () => {
  let insertCalls = 0;
  const query = {
    select() { return this; },
    eq() { return this; },
    contains() { return this; },
    async maybeSingle() { return { data: { id: 'event-1' }, error: null }; },
    async insert() { insertCalls += 1; return { data: null, error: null }; },
  };
  const result = await safeInsertEmailEvent({ from: () => query }, {
    organization_id: 'org-1',
    event_type: 'sent',
    meta: { dispatchId: 'dispatch-1' },
  });

  assert.deepEqual(result, { data: { id: 'event-1' }, error: null });
  assert.equal(insertCalls, 0);
});
