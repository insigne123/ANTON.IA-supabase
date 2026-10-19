import assert from 'node:assert/strict';
import test from 'node:test';

import { deltaText, nextActions, personalHeadline, reportEmail, reportWeek, weekLabel, type PersonalSection, type WeeklyReport } from './weekly-report';

const personal = (patch: Partial<PersonalSection> = {}): PersonalSection => ({
  sent: { now: 34, before: 20 }, contacted: { now: 30, before: 18 }, replies: { now: 5, before: 2 }, meetings: 1,
  pending: [], commitments: [], touches: null, ...patch,
});

test('the week runs Monday to Sunday in Chile, and «current» compares with the same days of the week before', () => {
  // Monday 20 Oct 2026, 09:00 in Chile (summer time, UTC−3).
  const monday = new Date('2026-10-20T12:00:00.000Z');
  const previous = reportWeek(monday, 'previous');
  assert.deepEqual([previous.start, previous.end, previous.label], ['2026-10-12', '2026-10-18', '12–18 oct']);
  assert.equal(previous.from, '2026-10-12T03:00:00.000Z', 'Monday 00:00 in Chile');
  assert.equal(previous.to, '2026-10-19T03:00:00.000Z');
  assert.equal(previous.previousFrom, '2026-10-05T03:00:00.000Z');
  const current = reportWeek(new Date('2026-10-22T15:00:00.000Z'), 'current');
  assert.deepEqual([current.start, current.end], ['2026-10-19', '2026-10-25']);
  assert.equal(current.to, '2026-10-22T15:00:00.000Z', 'until now');
  assert.equal(Date.parse(current.previousTo) - Date.parse(current.previousFrom), Date.parse(current.to) - Date.parse(current.from), 'the same span a week earlier');
  // Sunday night in Chile is still that week, though in UTC it is Monday.
  assert.equal(reportWeek(new Date('2026-10-26T02:30:00.000Z'), 'current').start, '2026-10-19');
  assert.equal(weekLabel('2026-09-28', '2026-10-04'), '28 sept – 4 oct');
});

test('one sentence says the week, and the change against the week before reads plainly', () => {
  assert.equal(personalHeadline(personal(), 'previous'), 'La semana pasada escribiste a 30 personas y te respondieron 5 (17 %). Una pidió reunión.');
  assert.equal(personalHeadline(personal({ sent: { now: 0, before: 3 }, contacted: { now: 0, before: 3 }, replies: { now: 0, before: 0 }, meetings: 0,
    pending: [{ id: 'c1', name: 'Paula', company: null, repliedAt: '2026-10-20T12:00:00Z' }] }), 'current'), 'Esta semana no enviaste correos. Te espera una respuesta.');
  assert.equal(personalHeadline(personal({ sent: { now: 0, before: 4 }, contacted: { now: 0, before: 4 }, replies: { now: 2, before: 0 } }), 'previous'),
    'La semana pasada no enviaste correos, pero te respondieron 2. Una pidió reunión.', 'replies to the emails of the weeks before');
  assert.equal(personalHeadline(personal({ replies: { now: 0, before: 0 }, meetings: 0 }), 'current'), 'Esta semana escribiste a 30 personas.');
  assert.equal(deltaText({ now: 34, before: 20 }), '+14 vs. la semana anterior');
  assert.equal(deltaText({ now: 3, before: 5 }), '−2 vs. la semana anterior');
  assert.equal(deltaText({ now: 4, before: 4 }), 'igual que la semana anterior');
  assert.equal(deltaText({ now: 0, before: 0 }), null);
});

test('«Para esta semana»: what waits for you first, at most three', () => {
  const report = {
    personal: personal({ sent: { now: 2, before: 10 }, pending: [{ id: 'c1', name: 'Paula', company: 'Retail Sur', repliedAt: '2026-10-20T12:00:00Z' }, { id: 'c2', name: 'Matías', company: null, repliedAt: '2026-10-21T12:00:00Z' }],
      commitments: [{ id: 'c3', name: 'Rosa', company: null, title: 'Demo', dueAt: '2026-10-23T13:00:00Z' }] }),
    team: null,
    opportunities: { found: { total: 3, recommended: 1, byKind: [] }, closing: [], unassignedClosing: 2, won: 0, lost: 0 },
  };
  const actions = nextActions(report);
  assert.deepEqual(actions.map(action => action.href), ['/contacted/replied', '/contacted?c=c3', '/opportunities']);
  assert.equal(actions[0].text, 'Responde a 2 personas que te escribieron');
  assert.match(actions[1].text, /^Demo con Rosa, el viernes 23$/);
  assert.equal(actions[2].text, 'Asigna 2 oportunidades que cierran esta semana');
  // A quiet week points to the people ready to write to.
  assert.deepEqual(nextActions({ personal: personal({ sent: { now: 0, before: 0 } }), team: null, opportunities: null }).map(action => action.href), ['/saved/leads/enriched']);
});

test('the email: the same report in a few lines, escaped, without tracking or unsubscribe', () => {
  const report: WeeklyReport = {
    week: reportWeek(new Date('2026-10-20T12:00:00.000Z'), 'previous'), roles: ['personal', 'team'], name: 'Nicolás',
    personal: personal({ pending: [{ id: 'c1', name: 'Paula <b>', company: null, repliedAt: '2026-10-17T12:00:00Z' }] }),
    team: { members: [{ userId: 'u1', name: 'Ana & Co', role: 'member', sent: 10, replies: 2, meetings: 0, pending: 1 }], totals: { sent: { now: 10, before: 4 }, replies: { now: 2, before: 1 }, meetings: 0 } },
    opportunities: null,
  };
  const email = reportEmail(report, 'https://app.example/');
  assert.equal(email.subject, 'Tu informe semanal · 12–18 oct');
  assert.match(email.html, /Hola, Nicolás/);
  assert.match(email.html, /Ana &amp; Co: 10 enviados, 2 respuestas, 1 por responder/);
  assert.match(email.html, /href="https:\/\/app\.example\/contacted\/replied"/);
  assert.match(email.text, /Ver el informe completo: https:\/\/app\.example\/weekly-report/);
  assert.doesNotMatch(email.html, /<b>|unsubscribe|tracking|pixel/i);
});
