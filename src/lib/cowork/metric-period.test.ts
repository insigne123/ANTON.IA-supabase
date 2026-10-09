import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkMetricQuery, coworkMetricSpan } from './metric-period';
test('calendar boundaries use Chile local time and differ from trailing windows', () => {
  const now = new Date('2026-10-09T05:00:00Z');
  assert.equal(coworkMetricSpan({ period: 'calendar_month', scope: 'own' }, now).startInclusive, '2026-10-01T03:00:00.000Z');
  assert.equal(coworkMetricSpan({ period: 'calendar_week', scope: 'organization' }, now).startInclusive, '2026-10-05T03:00:00.000Z');
  assert.equal(coworkMetricSpan({ period: 'calendar_month', scope: 'own' }, new Date('2026-09-30T20:00:00Z')).startInclusive, '2026-09-01T04:00:00.000Z');
  assert.equal(coworkMetricQuery('last_7_days'), null, 'legacy fixed-read inputs stay compatible');
  assert.throws(() => coworkMetricQuery('{"period":"calendar_month","scope":"all_tenants"}'));
});
