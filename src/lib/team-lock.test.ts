import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeLockEmail, normalizeLockLinkedin, teamLockFreeFrom, teamLockNotice, type TeamLock } from '@/lib/team-lock';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const lock = (patch: Partial<TeamLock> = {}): TeamLock => ({
  status: 'active', ownerName: 'Ana Pérez', mine: false, replied: false, lastContactedAt: '2026-10-04T15:00:00Z', ...patch,
});

test('a contact with no reply says who holds it and when it is free: 30 days after the last send', () => {
  assert.equal(teamLockFreeFrom(lock())?.toISOString(), '2026-11-03T15:00:00.000Z');
  assert.deepEqual(teamLockNotice(lock(), NOW), { text: 'Contactado por Ana Pérez · libre desde el 3 nov', blocks: true });
  assert.equal(teamLockNotice(lock({ lastContactedAt: '2026-09-01T10:00:00Z' }), NOW)?.text, 'Contactado por Ana Pérez · se libera hoy');
  assert.equal(teamLockNotice(lock({ lastContactedAt: null }), NOW)?.text, 'Contactado por Ana Pérez');
});

test('a reply keeps the contact with its owner, with no date', () => {
  assert.equal(teamLockFreeFrom(lock({ replied: true })), null);
  assert.equal(teamLockNotice(lock({ replied: true }), NOW)?.text, 'En conversación con Ana Pérez');
});

test('closed, suppressed and in preparation each say so', () => {
  assert.equal(teamLockNotice(lock({ status: 'closed' }), NOW)?.text, 'Ganado por Ana Pérez: no se vuelve a prospectar');
  assert.equal(teamLockNotice(lock({ status: 'suppressed' }), NOW)?.text, 'No contactar: el equipo lo cerró como No interesado');
  assert.equal(teamLockNotice(lock({ status: 'reserved' }), NOW)?.text, 'Ana Pérez está preparando un envío');
  assert.equal(teamLockNotice(lock({ ownerName: null, replied: true }), NOW)?.text, 'En conversación con otra persona del equipo');
});

test('your own contacts and free ones say nothing', () => {
  assert.equal(teamLockNotice(lock({ mine: true }), NOW), null);
  assert.equal(teamLockNotice(null, NOW), null);
  assert.equal(teamLockNotice(undefined, NOW), null);
});

test('people are compared by lowercased email and by LinkedIn profile, whatever the URL looks like', () => {
  assert.equal(normalizeLockEmail('  Marcela@Sodexo.CL '), 'marcela@sodexo.cl');
  assert.equal(normalizeLockLinkedin('https://www.linkedin.com/in/Marcela-Rojas/?trk=x'), 'linkedin.com/in/marcela-rojas');
  assert.equal(normalizeLockLinkedin('http://cl.linkedin.com/in/marcela-rojas'), 'linkedin.com/in/marcela-rojas');
  assert.equal(normalizeLockLinkedin('https://www.linkedin.com/company/sodexo'), '');
  assert.equal(normalizeLockLinkedin(null), '');
});
