import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleRates, compareChannels, detectIncidents, diagnoseHypotheses, extractMeetingCompletions } from './metrics';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

function contact(overrides: Record<string, unknown> = {}) {
  return { id: `c${Math.random()}`, sent_at: daysAgo(10), provider: 'gmail', ...overrides };
}

test('rates carry denominators and null instead of zero without sends', () => {
  const empty = assembleRates({ contacts: [], unsubscribedAt: [], meetingsAt: [], nowMs: NOW });
  assert.equal(empty.last_7_days.sent, 0);
  assert.equal(empty.last_7_days.rates.reply.value, null);
  assert.equal(empty.last_7_days.rates.reply.denominator, 0);
});

test('rates split humans, autos and bounces in both windows', () => {
  const contacts = [
    contact({ sent_at: daysAgo(2), replied_at: daysAgo(2), reply_intent: 'positive' }),
    contact({ sent_at: daysAgo(2), replied_at: daysAgo(2), reply_intent: 'meeting_request' }),
    contact({ sent_at: daysAgo(2), replied_at: daysAgo(2), reply_intent: 'auto_reply' }),
    contact({ sent_at: daysAgo(2), replied_at: null, bounced_at: daysAgo(2), reply_intent: 'delivery_failure' }),
    contact({ sent_at: daysAgo(20), replied_at: daysAgo(20), reply_intent: 'positive' }),
    contact({ sent_at: daysAgo(40), replied_at: daysAgo(40), reply_intent: 'positive' }),
  ];
  const result = assembleRates({ contacts, unsubscribedAt: [daysAgo(3)], meetingsAt: [daysAgo(1)], nowMs: NOW });
  assert.equal(result.last_7_days.sent, 4);
  assert.equal(result.last_7_days.humanReplies, 2);
  assert.equal(result.last_7_days.positives, 2);
  assert.equal(result.last_7_days.meetingsRequested, 1);
  assert.equal(result.last_7_days.autoReplies, 1);
  assert.equal(result.last_7_days.bounces, 1);
  assert.equal(result.last_7_days.unsubscribed, 1);
  assert.equal(result.last_7_days.meetingsConfirmed, 1);
  assert.equal(result.last_7_days.rates.reply.value, 0.5);
  assert.equal(result.last_30_days.sent, 5);
  assert.equal(result.last_30_days.humanReplies, 3);
});

test('meetings come only from completed meeting commitments', () => {
  const meetings = extractMeetingCompletions([
    { data: { commitment: { kind: 'meeting', completedAt: daysAgo(1) } } },
    { data: { commitment: { kind: 'call', completedAt: daysAgo(1) } } },
    { data: { commitment: { kind: 'meeting', completedAt: null } } },
    { data: null },
  ]);
  assert.equal(meetings.length, 1);
});

test('diagnose tests hypotheses without inventing causes', () => {
  const contacts = Array.from({ length: 60 }, (_, i) => contact({
    provider: i < 30 ? 'gmail' : 'outlook',
    replied_at: i < 6 ? daysAgo(2) : null,
    reply_intent: i < 6 ? 'positive' : null,
    bounced_at: i >= 6 && i < 9 ? daysAgo(2) : null,
  }));
  const hypotheses = diagnoseHypotheses({ contacts, stalledPositives: 2, nowMs: NOW });
  const byId = Object.fromEntries(hypotheses.map((h) => [h.id, h]));
  assert.equal(byId.deliverability.verdict, 'supported');
  assert.equal(byId.provider_gap.verdict, 'supported');
  assert.equal(byId.followup_gap.verdict, 'supported');
  assert.equal(byId.message_length.verdict, 'untestable');
  assert.ok(hypotheses.every((h) => h.warning), 'every hypothesis carries its limit');
});

test('diagnose stays inconclusive with small samples', () => {
  const contacts = [contact({ replied_at: daysAgo(2), reply_intent: 'positive' })];
  const byId = Object.fromEntries(diagnoseHypotheses({ contacts, stalledPositives: 0, nowMs: NOW }).map((h) => [h.id, h]));
  assert.equal(byId.deliverability.verdict, 'inconclusive');
  assert.equal(byId.provider_gap.verdict, 'inconclusive');
  assert.equal(byId.followup_gap.verdict, 'contradicted');
});

test('channels refuse to generalize without denominators', () => {
  const email = { channel: 'email' as const, period: 'last_30_days', sent: 1143, replies: 4, positives: 2, meetings: 2, pending: 0, sources: ['contacted_leads'] };
  const empty = { channel: 'linkedin' as const, period: 'last_30_days', sent: 0, replies: 0, positives: 0, meetings: 0, pending: 0, sources: ['cowork_linkedin_jobs'] };
  const result = compareChannels({ email, linkedin: empty });
  assert.equal(result.verdict, 'not_comparable');
  assert.ok(result.reasons.includes('linkedin_sin_envios_confirmados'));
  assert.ok(result.reasons.includes('audiencias_distintas_no_verificadas'));
  assert.ok(!JSON.stringify(result).match(/wins|ganador/i), 'never declares a winning channel');
});

test('incidents surface scheduled steps for replied contacts', () => {
  const checks = detectIncidents({
    steps: [
      { id: 's1', enrollment_id: 'e1', state: 'approved', due_at: daysAgo(-1) },
      { id: 's2', enrollment_id: 'e2', state: 'not_due', due_at: daysAgo(-1) },
    ],
    enrollments: [
      { id: 'e1', recipient_email: 'ana@x.test', status: 'active' },
      { id: 'e2', recipient_email: 'luis@x.test', status: 'active' },
    ],
    contactsByEmail: new Map([
      ['ana@x.test', { replied_at: daysAgo(2), evaluation_status: 'action_required' }],
      ['luis@x.test', { evaluation_status: 'do_not_contact' }],
    ]),
    unclassified: [{ id: 'c9', email: 'mia@x.test', replied_at: daysAgo(1) }],
    sweepErrors: [{ provider: 'gmail', last_error: 'timeout' }],
    syncErrorCounts: [{ state: 'connection_required', count: 3 }],
    openExceptions: [{ id: 'x1', title: 'T', category: 'positive_reply', severity: 'high' }],
  });
  const byCheck = Object.fromEntries(checks.map((c) => [c.check, c]));
  assert.equal(byCheck.steps_scheduled_for_replied.found, 1);
  assert.equal(byCheck.active_enrollments_do_not_contact.found, 1);
  assert.equal(byCheck.unclassified_backlog.found, 1);
  assert.equal(byCheck.sweep_errors.found, 1);
  assert.equal(byCheck.open_exceptions.found, 1);
  assert.ok(checks.every((c) => c.action), 'every check tells what to do');
});
