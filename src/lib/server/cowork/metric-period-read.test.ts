import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkPeriodMetrics } from './metric-period-read';
test('own/team exact counts and reply cohorts cannot include other organizations or old sends', async () => {
  const rows = [
    { id: 'a', organization_id: 'org', user_id: 'owner', sent_at: '2026-10-02T12:00:00Z', replied_at: '2026-10-03T12:00:00Z', reply_intent: 'positive' },
    { id: 'old', organization_id: 'org', user_id: 'owner', sent_at: '2026-09-01T12:00:00Z', replied_at: '2026-10-04T12:00:00Z', reply_intent: null },
    { id: 'b', organization_id: 'org', user_id: 'peer', sent_at: '2026-10-05T12:00:00Z', replied_at: '2026-10-06T12:00:00Z', reply_intent: 'meeting_request' },
    { id: 'private', organization_id: 'other-org', user_id: 'owner', sent_at: '2026-10-05T12:00:00Z', replied_at: '2026-10-06T12:00:00Z', reply_intent: 'positive' },
  ];
  const queries: Array<Array<[string, unknown]>> = [];
  const client = { from: () => {
    const filters: Array<(row: typeof rows[number]) => boolean> = [], scopes: Array<[string, unknown]> = [];
    const builder = {
      select: (_: string, options: unknown) => { assert.deepEqual(options, { count: 'exact', head: true }); return builder; },
      eq: (key: string, value: unknown) => { scopes.push([key, value]); filters.push(row => row[key as keyof typeof row] === value); return builder; },
      gte: (key: string, value: string) => { filters.push(row => row[key as keyof typeof row] !== null && Date.parse(String(row[key as keyof typeof row])) >= Date.parse(value)); return builder; },
      lt: (key: string, value: string) => { filters.push(row => row[key as keyof typeof row] !== null && Date.parse(String(row[key as keyof typeof row])) < Date.parse(value)); return builder; },
      or: () => { filters.push(row => !['auto_reply', 'delivery_failure'].includes(row.reply_intent || '')); return builder; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key as keyof typeof row])); return builder; },
      then: (resolve: (value: unknown) => unknown) => { queries.push(scopes); return Promise.resolve({ error: null, count: rows.filter(row => filters.every(filter => filter(row))).length, data: null }).then(resolve); },
    }; return builder;
  } };
  const scope = { userId: 'owner', organizationId: 'org' };
  const own = await readCoworkPeriodMetrics(client as never, scope, { period: 'calendar_month', scope: 'own' }, new Date('2026-10-09T12:00:00Z'));
  assert.deepEqual(own.counts, { sentHistoryRows: 1, repliesReceived: 2, positiveRepliesReceived: 1 });
  assert.equal(own.rates.reply.denominator, 1); assert.equal(own.rates.reply.numerator, 1);
  assert.ok(queries.every(scopes => scopes.some(([key,value]) => key === 'user_id' && value === 'owner')));
  queries.length = 0;
  const team = await readCoworkPeriodMetrics(client as never, scope, { period: 'calendar_month', scope: 'organization' }, new Date('2026-10-09T12:00:00Z'));
  assert.equal(team.counts.sentHistoryRows, 2); assert.equal(team.counts.repliesReceived, 3);
  assert.ok(queries.every(scopes => scopes.some(([key,value]) => key === 'organization_id' && value === 'org')));
});
