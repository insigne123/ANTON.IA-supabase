import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextCampaignMessage, type CampaignRecipient, type CampaignDelivery } from '../bulk-campaigns';
import {
  SEVEN_TOUCH_DELAY_DAYS, isSevenTouchCadence, describeCadence, NEGOTIATION_HOLD_STAGES,
  normalizeCompanyKey, emailDomain, companyKeysFor, planCompanyDays, classifySendRetry,
  santiagoDayBounds, msUntilNextSantiagoDay,
} from './send-cadence';

test('seven-touch cadence matches days 1/3/7/11/16/23/38', () => {
  assert.deepEqual([...SEVEN_TOUCH_DELAY_DAYS], [0, 2, 4, 4, 5, 7, 15]);
  assert.equal(isSevenTouchCadence([0, 2, 4, 4, 5, 7, 15]), true);
  assert.equal(isSevenTouchCadence([0, 2, 6]), false);
  assert.equal(isSevenTouchCadence([0, 1, 3]), false);
  assert.equal(describeCadence([0, 2, 4, 4, 5, 7, 15]), 'seven_touch');
  assert.equal(describeCadence([0, 3]), 'custom:2');
});

test('negotiation hold covers active conversation stages', () => {
  assert.ok(NEGOTIATION_HOLD_STAGES.includes('negotiation'));
  assert.ok(NEGOTIATION_HOLD_STAGES.includes('meeting'));
  assert.ok(!(NEGOTIATION_HOLD_STAGES as readonly string[]).includes('qualified'));
});

test('company keys retain domain across missing or variant names and avoid free-mail collisions', () => {
  assert.equal(normalizeCompanyKey('  GrupoExpro SpA '), 'grupoexpro spa');
  assert.equal(normalizeCompanyKey(''), null);
  assert.deepEqual(companyKeysFor('ana@grupoexpro.cl', 'GrupoExpro'), { keys: ['domain:grupoexpro.cl', 'company:grupoexpro'], basis: 'domain' });
  assert.deepEqual(companyKeysFor('ana@grupoexpro.cl', null), { keys: ['domain:grupoexpro.cl'], basis: 'domain' });
  const free = companyKeysFor('ana@gmail.com', null);
  assert.equal(free.basis, 'email');
  assert.equal(emailDomain('bad-address'), null);
});

test('real legacy scheduler lands on days 1/3/7/11/16/23/38 and never earlier', () => {
  const start = Date.parse('2026-09-01T12:00:00Z');
  const recipient = { messages: SEVEN_TOUCH_DELAY_DAYS.map((delayDays, i) => ({
    draftId: `draft-${i}`, versionId: `v-${i}`, delayDays, subject: 's', body: 'b',
  })) } as CampaignRecipient;
  const deliveries: CampaignDelivery[] = [];
  for (const [i, offset] of [0, 2, 6, 10, 15, 22, 37].entries()) {
    const due = start + offset * 86400000;
    assert.notEqual(nextCampaignMessage(recipient, deliveries, new Date(start).toISOString(), due - 1)?.state, 'ready');
    const next = nextCampaignMessage(recipient, deliveries, new Date(start).toISOString(), due);
    assert.equal(next?.state, 'ready'); assert.equal(next?.index, i);
    deliveries.push({ draft_id: `draft-${i}`, status: 'sent', completed_at: new Date(due).toISOString(), error_message: null });
  }
});

test('company day plan never books two recipients of one company per day', () => {
  const plan = planCompanyDays([
    { email: 'a@acme.cl', company: 'Acme' },
    { email: 'b@acme.cl', company: 'acme' },
    { email: 'c@beta.cl', company: 'Beta' },
    { email: 'd@gmail.com', company: null },
    { email: 'e@gmail.com', company: null },
  ], '2026-09-22');
  const days = Object.fromEntries(plan.map(item => [item.email, item.sendDay]));
  assert.equal(days['a@acme.cl'], '2026-09-22');
  assert.equal(days['b@acme.cl'], '2026-09-23');
  assert.equal(days['c@beta.cl'], '2026-09-22');
  assert.equal(days['d@gmail.com'], '2026-09-22');
  assert.equal(days['e@gmail.com'], '2026-09-22');
});

test('staggering covers both domain variants and same-name multi-domain companies', () => {
  const plan = planCompanyDays([
    { email: 'a@acme.cl', company: 'Acme' },
    { email: 'b@acme.cl', company: 'Acme SpA' },
  ], '2026-09-22');
  assert.equal(plan[0].sendDay, '2026-09-22');
  assert.equal(plan[1].sendDay, '2026-09-23');
  assert.ok(plan[0].companyKeys.includes('company:acme'));
  const multiDomain = planCompanyDays([
    { email: 'a@acme.cl', company: 'Acme' }, { email: 'c@acme.com', company: 'ACME' },
  ], '2026-09-22');
  assert.equal(multiDomain[1].sendDay, '2026-09-23');
});

test('retry classification separates network failure from invalid address', () => {
  assert.deepEqual(classifySendRetry('sent', null), { action: 'terminal', reason: 'already_sent' });
  assert.deepEqual(classifySendRetry('failed', 'recipient_suppressed'), { action: 'terminal', reason: 'recipient_suppressed' });
  assert.deepEqual(classifySendRetry('failed', 'BULK_CAMPAIGN_COMPANY_REPLIED'), { action: 'terminal', reason: 'BULK_CAMPAIGN_COMPANY_REPLIED' });
  assert.deepEqual(classifySendRetry('failed', 'daily_quota_exceeded'), { action: 'retry', reason: 'daily_quota_exceeded' });
  assert.deepEqual(classifySendRetry('deferred', 'daily_quota_exceeded'), { action: 'retry', reason: 'daily_quota_exceeded' });
  assert.deepEqual(classifySendRetry('unknown', null), { action: 'reconcile_first', reason: 'uncertain_outcome' });
  assert.deepEqual(classifySendRetry('pending', 'x'), { action: 'reconcile_first', reason: 'uncertain_outcome' });
  assert.deepEqual(classifySendRetry('failed', 'mystery_code'), { action: 'reconcile_first', reason: 'mystery_code' });
});

test('santiago day bounds contain now and last 23-25 hours', () => {
  for (const iso of ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z', '2026-09-22T12:00:00Z', '2026-04-05T03:30:00Z']) {
    const now = new Date(iso);
    const bounds = santiagoDayBounds(now);
    assert.ok(Date.parse(bounds.start) <= now.getTime());
    assert.ok(now.getTime() < Date.parse(bounds.end));
    const length = Date.parse(bounds.end) - Date.parse(bounds.start);
    assert.ok(length >= 23 * 3600000 && length <= 25 * 3600000, `${iso} -> ${length}`);
    assert.match(bounds.day, /^\d{4}-\d{2}-\d{2}$/);
    const wait = msUntilNextSantiagoDay(now);
    assert.ok(wait > 0 && wait <= 25 * 3600000);
  }
});
