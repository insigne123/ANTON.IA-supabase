import assert from 'node:assert/strict';
import test from 'node:test';

import { dayInZone, dayStartInZone, lastDaysInZone, previousRange } from '@/lib/admin/chile-time';
import {
  adoptionCsv,
  biggestDrop,
  buildAdoption,
  classifyReplies,
  compareResults,
  helpMessage,
  needsHelp,
  type MemberSignals,
} from '@/lib/admin/value';

const NOW = new Date('2026-10-01T15:00:00.000Z');

function member(overrides: Partial<MemberSignals>): MemberSignals {
  return {
    userId: 'u', name: 'Persona', email: 'persona@empresa.cl', role: 'member', invitedAt: '2026-09-01T00:00:00.000Z',
    lastSignInAt: '2026-09-30T12:00:00.000Z', lastActivityAt: null, mailConnected: true, profileReady: true, hasSent: true,
    ...overrides,
  };
}

const TEAM: MemberSignals[] = [
  member({ userId: 'a', name: 'Ana', lastSignInAt: null }),
  member({ userId: 'b', name: 'Beto', mailConnected: false, hasSent: false }),
  member({ userId: 'c', name: 'Carla', profileReady: false, hasSent: false }),
  member({ userId: 'd', name: 'Diego', lastSignInAt: '2026-09-10T12:00:00.000Z' }),
  member({ userId: 'e', name: 'Elena', hasSent: false }),
  member({ userId: 'f', name: 'Fran', lastSignInAt: '2026-08-01T00:00:00.000Z', lastActivityAt: '2026-09-29T00:00:00.000Z' }),
];

test('adoption follows each person from the invitation to the first send', () => {
  const adoption = buildAdoption(TEAM, NOW);
  assert.equal(adoption.members, 6);
  assert.equal(adoption.neverSignedIn, 1);
  assert.equal(adoption.active7, 4, 'recent activity counts even with an old sign-in');
  assert.equal(adoption.active30, 5);
  assert.deepEqual(adoption.funnel.map((step) => [step.id, step.value]), [
    ['invited', 6], ['signed_in', 5], ['active', 5], ['mail', 5], ['first_send', 3],
  ]);
  assert.deepEqual(biggestDrop(adoption.funnel), { from: adoption.funnel[3], to: adoption.funnel[4], lost: 2 });
  assert.equal(biggestDrop([{ id: 'invited', label: 'Invitadas', value: 2 }, { id: 'signed_in', label: 'Entraron', value: 2 }]), null);
});

test('who needs help: one line per stuck person, the most blocking reason first', () => {
  const help = needsHelp(TEAM, NOW);
  assert.deepEqual(help.map((item) => [item.name, item.reason, item.action]), [
    ['Ana', 'never_signed_in', 'copy_invite'],
    ['Beto', 'no_mail', 'copy_mail_reminder'],
    ['Carla', 'no_profile', 'copy_profile_reminder'],
    ['Diego', 'inactive', 'open_person'],
    ['Elena', 'no_send', 'open_person'],
  ]);
  assert.equal(help[3].title, 'Sin actividad hace 21 días');
});

test('the copied messages never send anything and name where to go', () => {
  const [invite, mail] = needsHelp(TEAM, NOW);
  const text = helpMessage(invite, 'https://app.example.cl', 'GrupoExpro');
  assert.match(text, /^Hola, Ana: te invitamos a ANTON\.IA, donde GrupoExpro/);
  assert.match(text, /https:\/\/app\.example\.cl\/login con tu correo persona@empresa\.cl/);
  assert.match(helpMessage(mail, 'https://app.example.cl', 'GrupoExpro'), /\/connections/);
  assert.equal(helpMessage({ ...mail, action: 'open_person' }, 'x', 'y'), '');
});

test('replies by intent: automatic answers and bounces are reported apart and never count as a reply', () => {
  const breakdown = classifyReplies([
    { reply_intent: 'meeting_request' }, { reply_intent: 'positive' }, { reply_intent: 'positive' }, { reply_intent: 'negative' },
    { reply_intent: 'unsubscribe' }, { reply_intent: 'auto_reply' }, { reply_intent: 'delivery_failure' }, { reply_intent: null },
  ]);
  assert.deepEqual(breakdown, { real: 6, meeting: 1, positive: 2, neutral: 1, negative: 1, unsubscribe: 1, automatic: 1, bounced: 1 });
});

test('results are compared with the previous period of the same length', () => {
  const base = { replies: classifyReplies([]), interested: 0, pipelineMeetings: 0, savedContacts: 0, researched: 0 };
  const comparison = compareResults({ ...base, sent: 12, interested: 2 }, { ...base, sent: 5, interested: 2, researched: 4 });
  assert.deepEqual(comparison.sent, { value: 12, previous: 5, delta: 7, trend: 'up' });
  assert.equal(comparison.interested.trend, 'flat');
  assert.equal(comparison.researched.trend, 'down');
  assert.deepEqual(previousRange({ from: '2026-09-02', to: '2026-10-01' }), { from: '2026-08-03', to: '2026-09-01' });
  assert.deepEqual(previousRange({ from: '2026-10-01', to: '2026-10-01' }), { from: '2026-09-30', to: '2026-09-30' });
});

test('Chile calendar days, daylight saving included', () => {
  assert.equal(dayStartInZone('2026-07-15').toISOString(), '2026-07-15T04:00:00.000Z', 'winter: UTC-4');
  assert.equal(dayStartInZone('2026-10-15').toISOString(), '2026-10-15T03:00:00.000Z', 'summer: UTC-3');
  assert.equal(dayInZone(new Date('2026-10-02T02:30:00.000Z')), '2026-10-01', '23:30 in Santiago is still the 1st');
  assert.deepEqual(lastDaysInZone(7, new Date('2026-10-02T02:30:00.000Z')), { from: '2026-09-25', to: '2026-10-01' });
});

test('the people export opens in Excel with accents and quotes intact', () => {
  const csv = adoptionCsv([member({ name: 'Núñez, José', lastSignInAt: null })], NOW);
  assert.ok(csv.startsWith('﻿Persona,Correo,Rol,Último uso'));
  assert.match(csv, /\r\n"Núñez, José",persona@empresa\.cl,member,Nunca,Sí,Sí,Sí,Nunca ha entrado\r\n$/);
});
