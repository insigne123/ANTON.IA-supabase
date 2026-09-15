import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransitionCoworkRun, coworkRequestSchema } from './contracts';

test('requests cannot supply ownership or arbitrary tools', () => {
  const input = { requestId: '00000000-0000-4000-8000-000000000001', message: 'Investiga esta cuenta' };
  assert.equal(coworkRequestSchema.parse(input).mode, 'approval');
  for (const extra of [{ userId: 'attacker' }, { organizationId: 'other' }, { tool: 'email.send' }]) {
    assert.equal(coworkRequestSchema.safeParse({ ...input, ...extra }).success, false);
  }
  assert.equal(coworkRequestSchema.safeParse({ ...input, message: ' ' }).success, false);
});

test('terminal runs cannot be re-executed by transition', () => {
  for (const status of ['completed', 'failed', 'cancelled'] as const) {
    assert.equal(canTransitionCoworkRun(status, 'running'), false);
  }
  assert.equal(canTransitionCoworkRun('queued', 'completed'), false);
  assert.equal(canTransitionCoworkRun('running', 'waiting_approval'), true);
});
