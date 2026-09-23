import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTACT_POLICY, evaluateContactPolicy, evaluateFrequency, findObligations, OUTREACH_LAW, resolveIndustry } from './compliance';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW - hours * 3600000).toISOString();

test('frequency holds on daily, weekly and 40-day caps', () => {
  assert.equal(evaluateFrequency([], NOW).held, false);
  const daily = evaluateFrequency([hoursAgo(2)], NOW);
  assert.equal(daily.held, true);
  assert.equal(daily.window, 'day');
  assert.ok(Date.parse(daily.nextEligibleAt!) > NOW);
  const weekly = evaluateFrequency([hoursAgo(30), hoursAgo(50), hoursAgo(100)], NOW);
  assert.deepEqual([weekly.held, weekly.window, weekly.count], [true, 'week', 3]);
  const monthly = evaluateFrequency(Array.from({ length: 8 }, (_, i) => hoursAgo(200 + i * 100)), NOW);
  assert.deepEqual([monthly.held, monthly.window], [true, '40d']);
  const old = evaluateFrequency([hoursAgo(25), hoursAgo(26)], NOW);
  assert.equal(old.held, false);
});

test('canonical cadence never trips the caps by itself', () => {
  // Días 1/3/7/11/16/23/38 como demoras 0/2/4/4/5/7/15 desde un inicio.
  const gaps = [0, 2, 4, 4, 5, 7, 15];
  let at = NOW - 38 * 86400000;
  const sends: string[] = [];
  for (const gap of gaps) { at += gap * 86400000; sends.push(new Date(Math.min(at, NOW)).toISOString()); }
  const past = sends.filter((at) => Date.parse(at) <= NOW);
  const result = evaluateFrequency(past, NOW);
  assert.equal(result.held, false, 'la cadencia canónica no debe frenarse sola');
  assert.ok(CONTACT_POLICY.maxPerPersonPer40d >= 7);
});

test('policy blocks suppression first, defers the rest', () => {
  const base = { suppressed: false, doNotContact: false, excludedDomain: false,
    frequency: evaluateFrequency([], NOW), companyDayCollision: false, replied: false };
  assert.deepEqual(evaluateContactPolicy(base).verdict, 'allow');
  assert.deepEqual(evaluateContactPolicy({ ...base, suppressed: true }).verdict, 'block');
  assert.deepEqual(evaluateContactPolicy({ ...base, doNotContact: true }).verdict, 'block');
  assert.deepEqual(evaluateContactPolicy({ ...base, excludedDomain: true }).verdict, 'block');
  const deferred = evaluateContactPolicy({ ...base, replied: true, companyDayCollision: true });
  assert.equal(deferred.verdict, 'defer');
  assert.ok(deferred.reasons.includes('recipient_replied'));
});

test('outreach law carries jurisdiction, dates and sources', () => {
  assert.equal(OUTREACH_LAW.jurisdiction, 'CL');
  assert.equal(OUTREACH_LAW.current.law, 'Ley 19.628');
  assert.equal(OUTREACH_LAW.incoming.law, 'Ley 21.719');
  assert.equal(OUTREACH_LAW.incoming.inForce, '2026-12-01');
  assert.ok(OUTREACH_LAW.current.source.includes('leychile'));
  assert.ok(OUTREACH_LAW.disclaimer.length > 10);
});

test('obligations disambiguate industry and never invent', () => {
  const mining = findObligations('Minera de cobre');
  assert.equal(mining.disambiguated, true);
  assert.ok(mining.obligations.some((o) => o.law === 'DS 594'));
  assert.ok(mining.obligations.some((o) => o.law.startsWith('Ley 21.643')));
  const bank = findObligations('banco');
  assert.ok(bank.obligations.some((o) => o.law === 'Ley 20.393'));
  const unknown = findObligations('astrología cuántica');
  assert.equal(unknown.disambiguated, false);
  assert.equal(unknown.industry, null);
  assert.ok(unknown.obligations.length >= 2, 'base para todo empleador');
  assert.ok(unknown.obligations.every((o) => o.law && o.source && o.published && o.inForce));
  assert.equal(resolveIndustry(''), null);
});
