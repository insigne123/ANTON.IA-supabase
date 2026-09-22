import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LINKEDIN_WEEKLY_INVITE_LIMIT, LINKEDIN_FOLLOWUP_COOLDOWN_DAYS,
  inviteIdempotencyKey, messageIdempotencyKey, verifyLinkedinIdentity,
  classifyInviteQuota, followupEligible, jobExpired,
} from './linkedin-bridge';

test('identity requires exact canonical url match', () => {
  assert.throws(() => verifyLinkedinIdentity(
    { url: 'https://www.linkedin.com/in/otra-persona', name: 'Ana' },
    { kind: 'saved_lead', url: 'https://www.linkedin.com/in/ana-perez', name: 'Ana Pérez' }),
    /no coincide/);
  assert.throws(() => verifyLinkedinIdentity({ url: 'not-a-url', name: 'Ana' },
    { kind: 'saved_lead', url: 'https://www.linkedin.com/in/ana-perez', name: 'Ana Pérez' }), /no es válida/);
});

test('identity refuses slug-name conflicts like the apollo mismatch', () => {
  assert.throws(() => verifyLinkedinIdentity(
    { url: 'https://www.linkedin.com/in/marco-psenda', name: 'Marco Psenda' },
    { kind: 'saved_lead', url: 'https://www.linkedin.com/in/marco-psenda', name: 'Janet Montero' }),
    /no corresponde/);
});

test('identity verifies shared name tokens and flags missing names', () => {
  const ok = verifyLinkedinIdentity(
    { url: 'https://www.linkedin.com/in/ana-perez/', name: 'Ana Pérez' },
    { kind: 'extension_capture', url: 'https://www.linkedin.com/in/ana-perez', name: 'Ana Pérez Soto' });
  assert.equal(ok.nameCheck, 'verified');
  const thin = verifyLinkedinIdentity({ url: 'https://www.linkedin.com/in/ana-perez', name: 'Ana' },
    { kind: 'saved_lead', url: 'https://www.linkedin.com/in/ana-perez', name: 'Ana Pérez' });
  assert.equal(thin.nameCheck, 'unverified');
  assert.throws(() => verifyLinkedinIdentity(
    { url: 'https://www.linkedin.com/in/ana-perez', name: 'Luis García Contreras' },
    { kind: 'saved_lead', url: 'https://www.linkedin.com/in/ana-perez', name: 'Ana Pérez Soto' }), /no corresponde/);
});

test('idempotency keys separate invites from message content', () => {
  const invite = inviteIdempotencyKey('org', 'user', 'https://www.linkedin.com/in/ana');
  assert.equal(invite, inviteIdempotencyKey('org', 'user', 'https://www.linkedin.com/in/Ana/'));
  assert.notEqual(invite, messageIdempotencyKey('org', 'user', 'https://www.linkedin.com/in/ana', 'Hola'));
  assert.notEqual(
    messageIdempotencyKey('org', 'user', 'https://www.linkedin.com/in/ana', 'Hola'),
    messageIdempotencyKey('org', 'user', 'https://www.linkedin.com/in/ana', 'Hola de nuevo'));
});

test('quota counts pending invitations against the observed weekly limit', () => {
  assert.equal(LINKEDIN_WEEKLY_INVITE_LIMIT, 100);
  assert.equal(classifyInviteQuota(99, 0).allowed, true);
  const full = classifyInviteQuota(90, 10);
  assert.equal(full.allowed, false);
  assert.match(full.reason, /100/);
});

test('followup requires cooldown, silence, open stage and new content', () => {
  const now = new Date('2026-09-22T12:00:00Z').getTime();
  const base = { lastConfirmedAt: '2026-09-10T12:00:00Z', lastInboundAt: null,
    crmStages: ['contacted'], lastMessageHash: 'a'.repeat(64), newMessageHash: 'b'.repeat(64), now };
  assert.deepEqual(followupEligible(base), { eligible: true, reasons: [] });
  assert.ok(!followupEligible({ ...base, lastConfirmedAt: new Date(now - 2 * 86400000).toISOString() }).eligible);
  assert.deepEqual(followupEligible({ ...base, lastInboundAt: '2026-09-15T12:00:00Z' }).reasons, ['inbound_reply_observed']);
  assert.deepEqual(followupEligible({ ...base, crmStages: ['negotiation'] }).reasons, ['negotiation_hold']);
  assert.deepEqual(followupEligible({ ...base, newMessageHash: 'a'.repeat(64) }).reasons, ['repeated_content']);
  assert.deepEqual(followupEligible({ ...base, lastConfirmedAt: null }).reasons, ['no_confirmed_send']);
});

test('queued jobs expire after seven days without auto-execution', () => {
  const now = new Date('2026-09-22T12:00:00Z').getTime();
  assert.equal(jobExpired('2026-09-21T12:00:00Z', now), false);
  assert.equal(jobExpired('2026-09-10T12:00:00Z', now), true);
  assert.equal(LINKEDIN_FOLLOWUP_COOLDOWN_DAYS, 7);
});
