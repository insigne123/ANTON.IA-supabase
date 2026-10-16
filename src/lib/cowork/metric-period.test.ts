import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkMetricQuery, coworkMetricSpan } from './metric-period';
test('calendar boundaries use Chile local time and differ from trailing windows', () => {
  const now = new Date('2026-10-09T05:00:00Z');
  assert.equal(coworkMetricSpan({ period: 'calendar_month', scope: 'own' }, now).startInclusive, '2026-10-01T03:00:00.000Z');
  assert.equal(coworkMetricSpan({ period: 'calendar_week', scope: 'organization' }, now).startInclusive, '2026-10-05T03:00:00.000Z');
  assert.equal(coworkMetricSpan({ period: 'calendar_month', scope: 'own' }, new Date('2026-09-30T20:00:00Z')).startInclusive, '2026-09-01T04:00:00.000Z');
  // The week and the month before end where this one starts.
  const week = coworkMetricSpan({ period: 'previous_calendar_week', scope: 'own' }, now);
  assert.deepEqual([week.startInclusive, week.endExclusive], ['2026-09-28T03:00:00.000Z', '2026-10-05T03:00:00.000Z']);
  const last = coworkMetricSpan({ period: 'previous_calendar_month', scope: 'own' }, now);
  assert.deepEqual([last.startInclusive, last.endExclusive], ['2026-09-01T04:00:00.000Z', '2026-10-01T03:00:00.000Z']);
  assert.equal(coworkMetricSpan({ period: 'calendar_week', scope: 'own' }, now).endExclusive, '2026-10-09T05:00:00.001Z');
  assert.equal(coworkMetricQuery('last_7_days'), null, 'legacy fixed-read inputs stay compatible');
  assert.throws(() => coworkMetricQuery('{"period":"calendar_month","scope":"all_tenants"}'));
});
