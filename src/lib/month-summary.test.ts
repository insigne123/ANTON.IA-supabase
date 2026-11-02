import assert from 'node:assert/strict';
import test from 'node:test';

import { monthOpportunities, monthRecommendation, monthRows, opportunitiesSentence, reportMonth, type MonthSection } from './month-summary';
import { reportEmail, reportWeek, type WeeklyReport } from './weekly-report';

test('the month before, only during the first seven days of a month in Chile', () => {
  assert.deepEqual(reportMonth(new Date('2026-11-02T12:00:00.000Z')), {
    start: '2026-10-01', label: 'octubre', from: '2026-10-01T03:00:00.000Z', to: '2026-11-01T03:00:00.000Z',
  });
  assert.equal(reportMonth(new Date('2026-11-07T12:00:00.000Z'))?.start, '2026-10-01', 'the 7th still is the first week');
  assert.equal(reportMonth(new Date('2026-11-08T12:00:00.000Z')), null);
  assert.equal(reportMonth(new Date('2026-11-01T02:00:00.000Z')), null, 'still 31 October in Chile');
  assert.equal(reportMonth(new Date('2027-01-04T12:00:00.000Z'))?.start, '2026-12-01', 'January tells December of the year before');
  assert.equal(reportMonth(new Date('2027-01-04T12:00:00.000Z'))?.label, 'diciembre');
});

test('the opportunities count by where the month left them, and the won ones by their amount', () => {
  const move = (opportunityId: string, to: string, day: number, amount?: number) => ({ opportunityId, to, amount, createdAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z` });
  const result = monthOpportunities([
    move('o1', 'submitted', 5), move('o1', 'won', 20, 85_000_000), // presented and won, with the amount told at the close
    move('o2', 'submitted', 6), move('o2', 'working', 7), // a tick taken back: not presented
    move('o3', 'lost', 9), // lost without being presented
    move('o4', 'won', 10), move('o4', 'working', 12), // won by mistake and reopened
    move('o5', 'won', 15), // the opportunity's own amount, in dollars
    move('o6', 'won', 16), // no amount anywhere
    move('o7', 'submitted', 17), move('o7', 'archived', 30), // presented, then put aside (a void tender): still presented
  ], [
    { id: 'o1', amount: 90_000_000, currency: 'CLP' }, { id: 'o5', amount: 40_000, currency: 'USD' }, { id: 'o6', amount: null, currency: null },
  ]);
  assert.deepEqual(result, { submitted: 2, won: 3, lost: 1, wonAmounts: [{ currency: 'CLP', amount: 85_000_000 }, { currency: 'USD', amount: 40_000 }], wonWithoutAmount: 1 });
  assert.equal(opportunitiesSentence(result), 'Oportunidades: 2 presentadas, 3 ganadas por $85.000.000 + USD 40.000 (1 sin monto) y 1 perdida.');
  assert.equal(monthOpportunities([], []), null, 'a month without moves is none');
  assert.equal(opportunitiesSentence({ submitted: 2, won: 0, lost: 0, wonAmounts: [], wonWithoutAmount: 0 }), 'Oportunidades: 2 presentadas.');
  assert.equal(opportunitiesSentence({ submitted: 0, won: 1, lost: 0, wonAmounts: [], wonWithoutAmount: 1 }), 'Oportunidades: 1 ganada.', 'no amount, no «por»');
});

const credits = { credits: 2343, paid: 262, withPhone: 180, contacted: 40, conversations: 12, meetings: 3, waiting: 0 };
const month = (extra: Partial<MonthSection> = {}): MonthSection => ({
  start: '2026-10-01', label: 'octubre', from: '2026-10-01T03:00:00.000Z', to: '2026-11-01T03:00:00.000Z', credits, opportunities: null, ...extra,
});

test('one thing to do: contact who was paid for, find people, or call; nothing when the month went well', () => {
  assert.deepEqual(monthRecommendation(month({ credits: { ...credits, waiting: 120 } })), {
    text: '120 personas pagadas llevan más de una semana sin contacto: en Administración ves quién pidió cada una', href: '/dashboard/admin/usage',
  });
  assert.match(monthRecommendation(month({ credits: { ...credits, waiting: 1 } }))!.text, /^Una persona pagada lleva más de una semana sin contacto/);
  assert.deepEqual(monthRecommendation(month({ credits: { ...credits, credits: 0, paid: 0, contacted: 0, conversations: 0, meetings: 0 } })), {
    text: 'En octubre nadie pidió datos de contacto: busquen personas nuevas en «Buscar»', href: '/search',
  });
  assert.equal(monthRecommendation(month({ credits: { ...credits, conversations: 0, meetings: 0 } }))?.href, '/saved/leads/enriched?etapa=to_call', 'emails without a conversation: call');
  assert.equal(monthRecommendation(month()), null);
  assert.equal(monthRecommendation(month({ credits: null })), null, 'unread credits recommend nothing');
});

test('the month\'s lines, and the email section on the first Monday', () => {
  const full = month({ credits: { ...credits, waiting: 2 }, opportunities: { submitted: 3, won: 1, lost: 2, wonAmounts: [{ currency: 'CLP', amount: 85_000_000 }], wonWithoutAmount: 0 } });
  assert.deepEqual(monthRows(full), [
    { text: 'En octubre, con 2.343 créditos hubo datos de 262 personas: se contactó a 40, con 12 conversaciones y 3 reuniones', href: '/dashboard/admin/usage' },
    { text: '195 créditos por conversación · 781 por reunión' },
    { text: 'Oportunidades: 3 presentadas, 1 ganada por $85.000.000 y 2 perdidas', href: '/opportunities' },
    { text: '2 personas pagadas llevan más de una semana sin contacto: en Administración ves quién pidió cada una', href: '/dashboard/admin/usage' },
  ]);
  assert.deepEqual(monthRows(month({ credits: null })), [], 'nothing read, nothing told');

  const now = new Date('2026-11-02T12:00:00.000Z');
  const report: WeeklyReport = {
    week: reportWeek(now, 'previous'), roles: ['personal', 'team'], name: 'Gonzalo', team: null, opportunities: null,
    personal: { sent: { now: 0, before: 0 }, contacted: { now: 0, before: 0 }, replies: { now: 0, before: 0 }, meetings: 0, pending: [], commitments: [], touches: null },
  };
  const withMonth = reportEmail({ ...report, month: full }, 'https://app.example');
  assert.match(withMonth.text, /\nRESUMEN DE OCTUBRE\n- En octubre, con 2\.343 créditos hubo datos de 262 personas: se contactó a 40, con 12 conversaciones y 3 reuniones \(https:\/\/app\.example\/dashboard\/admin\/usage\)\n/);
  assert.match(withMonth.html, /Resumen de octubre/);
  assert.match(withMonth.text, /- Oportunidades: 3 presentadas, 1 ganada por \$85\.000\.000 y 2 perdidas \(https:\/\/app\.example\/opportunities\)/);
  assert.doesNotMatch(reportEmail(report, 'https://app.example').text, /RESUMEN DE/, 'the other Mondays, no month');
});
