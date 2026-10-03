import assert from 'node:assert/strict';
import test from 'node:test';

import { describeInvitePreview, inviteAcceptErrorMessage, maskEmail, type InviteRow } from './organization-invite-preview';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const invite = (overrides: Partial<InviteRow> = {}): InviteRow => ({
  email: 'Valentina.Rios@yago-qa.cl', role: 'member', expires_at: '2026-10-08T12:00:00Z', accepted_at: null, revoked_at: null, ...overrides,
});

test('the address is shown masked, never whole', () => {
  assert.equal(maskEmail('valentina.rios@yago-qa.cl'), 'va•••@yago-qa.cl');
  assert.equal(maskEmail(' Ab@x.cl '), 'a•••@x.cl');
  assert.equal(maskEmail('sin-arroba'), '');
  assert.equal(maskEmail('a@b@c'), '');
  assert.equal(maskEmail(null), '');
});

test('a valid invitation names the organization and the role, and says whether the signed-in account is the invited one', () => {
  const anonymous = describeInvitePreview(invite(), 'Yago QA', { now: NOW, sessionEmail: null });
  assert.deepEqual(anonymous, {
    status: 'valid', organizationName: 'Yago QA', role: 'member', emailHint: 'va•••@yago-qa.cl', expiresAt: '2026-10-08T12:00:00Z', signedIn: false, matchesSession: null,
  });
  assert.equal(describeInvitePreview(invite(), 'Yago QA', { now: NOW, sessionEmail: 'valentina.rios@YAGO-QA.cl' }).status === 'valid'
    && (describeInvitePreview(invite(), 'Yago QA', { now: NOW, sessionEmail: ' valentina.rios@yago-qa.cl ' }) as { matchesSession: boolean }).matchesSession, true);
  const other = describeInvitePreview(invite(), 'Yago QA', { now: NOW, sessionEmail: 'diego@yago-qa.cl' });
  assert.equal(other.status, 'valid');
  assert.equal((other as { matchesSession: boolean }).matchesSession, false);
});

test('revoked, used and expired follow the order the accept function checks; a missing invitation says nothing about the organization', () => {
  assert.equal(describeInvitePreview(invite({ revoked_at: '2026-10-01T00:00:00Z', accepted_at: '2026-10-02T00:00:00Z' }), 'Yago QA', { now: NOW, sessionEmail: null }).status, 'revoked');
  assert.equal(describeInvitePreview(invite({ accepted_at: '2026-10-02T00:00:00Z', expires_at: '2026-10-01T00:00:00Z' }), 'Yago QA', { now: NOW, sessionEmail: null }).status, 'used');
  assert.equal(describeInvitePreview(invite({ expires_at: '2026-10-03T12:00:00Z' }), 'Yago QA', { now: NOW, sessionEmail: null }).status, 'expired', 'expires at the exact instant');
  assert.equal(describeInvitePreview(invite({ expires_at: null }), 'Yago QA', { now: NOW, sessionEmail: null }).status, 'expired');
  assert.deepEqual(describeInvitePreview(null, 'Yago QA', { now: NOW, sessionEmail: null }), { status: 'invalid' });
  assert.deepEqual(describeInvitePreview(invite(), null, { now: NOW, sessionEmail: null }), { status: 'invalid' });
});

test('an unknown role reads as member, the least access', () => {
  const preview = describeInvitePreview(invite({ role: 'superuser' }), 'Yago QA', { now: NOW, sessionEmail: null });
  assert.equal((preview as { role: string }).role, 'member');
  assert.equal((describeInvitePreview(invite({ role: 'admin' }), 'Yago QA', { now: NOW, sessionEmail: null }) as { role: string }).role, 'admin');
});

test('the accept errors reach the person in Spanish', () => {
  assert.match(inviteAcceptErrorMessage('Invitation belongs to another email address'), /^Esta invitación es para otro correo/);
  assert.match(inviteAcceptErrorMessage('Invitation is invalid or expired'), /^La invitación venció o ya se usó/);
  assert.match(inviteAcceptErrorMessage('Unauthorized'), /^Tu sesión venció/);
  assert.equal(inviteAcceptErrorMessage('ORGANIZATION_INVITE_ACCEPT_FAILED'), 'No pudimos aceptar la invitación. Intenta de nuevo.');
  assert.equal(inviteAcceptErrorMessage(undefined), 'No pudimos aceptar la invitación. Intenta de nuevo.');
});
