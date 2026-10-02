import test from 'node:test';
import assert from 'node:assert/strict';
import { daysAgo, profilePresence, type PresenceFacts } from './extension-presence';

const NOW = Date.parse('2026-10-02T15:00:00Z');
const none: PresenceFacts = { lock: null, saved: null, lastLinkedinAt: null, lastEmailAt: null, repliedAt: null };
const lock = (status: 'saved' | 'active' | 'closed', extra: Partial<NonNullable<PresenceFacts['lock']>> = {}) => ({
  status, ownerName: 'Ana', mine: false, replied: false, lastContactedAt: '2026-09-28T12:00:00Z', ...extra,
});

test('nothing known, nothing shown', () => {
  assert.equal(profilePresence(none, NOW), null);
});

test('someone else working the contact comes first, and says whether it blocks', () => {
  assert.deepEqual(profilePresence({ ...none, saved: { mine: true }, lock: lock('saved') }, NOW), { label: 'Guardado por Ana', tone: 'info', blocks: false });
  assert.deepEqual(profilePresence({ ...none, lock: lock('active', { replied: true }) }, NOW), { label: 'En conversación con Ana', tone: 'warning', blocks: true });
  assert.equal(profilePresence({ ...none, lock: lock('closed') }, NOW)?.label, 'Ganado por Ana: no se vuelve a prospectar');
  // One's own lock says nothing here: the facts of one's own contact speak instead.
  assert.equal(profilePresence({ ...none, lock: lock('active', { mine: true }), lastEmailAt: '2026-09-30T12:00:00Z' }, NOW)?.label, 'Contactado hace 2 días por correo');
});

test('a reply after the last contact, then the last contact by its channel, then saved', () => {
  assert.deepEqual(profilePresence({ ...none, lastEmailAt: '2026-09-27T12:00:00Z', repliedAt: '2026-10-01T12:00:00Z' }, NOW), { label: 'Respondió ayer', tone: 'success', blocks: false });
  // A reply older than the newest contact is not news.
  assert.equal(profilePresence({ ...none, lastLinkedinAt: '2026-10-02T09:00:00Z', repliedAt: '2026-09-20T12:00:00Z' }, NOW)?.label, 'Contactado hoy por LinkedIn');
  assert.equal(profilePresence({ ...none, saved: { mine: true } }, NOW)?.label, 'Guardado');
  assert.equal(profilePresence({ ...none, saved: { mine: false } }, NOW)?.label, 'Guardado en tu organización');
});

test('days read as people say them', () => {
  assert.equal(daysAgo('2026-10-02T03:00:00Z', NOW), 'hoy');
  assert.equal(daysAgo('2026-10-01T12:00:00Z', NOW), 'ayer');
  assert.equal(daysAgo('2026-09-20T12:00:00Z', NOW), 'hace 12 días');
});
