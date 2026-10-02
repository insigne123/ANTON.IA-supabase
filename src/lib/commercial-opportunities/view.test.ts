import test from 'node:test';
import assert from 'node:assert/strict';
import { filterOpportunities, formatDay, formatUsd, lastSearch, parseList, relativeTime, statusCounts } from './view';

const items = [
  { id: '1', company: 'Sodimac', status: 'new' as const, score: 80 },
  { id: '2', company: 'Securitas Chile', status: 'interested' as const, score: 70 },
  { id: '3', company: 'Agrosuper', status: 'dismissed' as const, score: 60 },
  { id: '4', company: 'Cencosud', status: 'converted' as const, score: 50 },
];

test('the tabs count by status; «Todas» leaves out the discarded and «Me interesan» includes the converted', () => {
  assert.deepEqual(statusCounts(items), { new: 1, interested: 2, dismissed: 1, all: 3 });
  assert.deepEqual(filterOpportunities(items, 'all', '').map(item => item.id), ['1', '2', '4']);
  assert.deepEqual(filterOpportunities(items, 'all', 'securitas').map(item => item.id), ['2']);
  assert.deepEqual(filterOpportunities(items, 'dismissed', 'AGRO').map(item => item.id), ['3']);
});

test('the last search joins the runs started together and says when a source failed', () => {
  assert.equal(lastSearch([]), null);
  const runs = [
    { source: 'linkedin', status: 'failed', startedAt: '2026-10-02T12:00:30Z', finishedAt: '2026-10-02T12:01:00Z', fetched: 0, created: 0, costUsd: 0, error: 'Apify rechazó el token.' },
    { source: 'jsearch', status: 'succeeded', startedAt: '2026-10-02T12:00:00Z', finishedAt: '2026-10-02T12:00:20Z', fetched: 90, created: 4, costUsd: 0.025, error: null },
    { source: 'jsearch', status: 'succeeded', startedAt: '2026-10-01T12:00:00Z', finishedAt: '2026-10-01T12:00:20Z', fetched: 80, created: 2, costUsd: 0.025, error: null },
  ];
  const last = lastSearch(runs);
  assert.equal(last?.status, 'partial');
  assert.equal(last?.fetched, 90);
  assert.deepEqual(last?.errors, ['LinkedIn: Apify rechazó el token.']);
  assert.equal(lastSearch([{ ...runs[1], status: 'skipped' }])?.status, 'skipped');
  assert.equal(lastSearch([{ ...runs[1], status: 'running', finishedAt: null }])?.status, 'running');
});

test('money, dates and lists read in Chilean Spanish', () => {
  assert.equal(formatUsd(1.026), 'US$1,03');
  assert.equal(formatUsd(10), 'US$10,00');
  assert.equal(formatDay(null), 'sin fecha');
  assert.match(formatDay('2026-09-25T12:00:00Z'), /^25 sept?$/);
  const now = Date.parse('2026-10-02T12:00:00Z');
  assert.equal(relativeTime('2026-10-02T11:59:50Z', now), 'recién');
  assert.equal(relativeTime('2026-10-02T09:00:00Z', now), 'hace 3 h');
  assert.equal(relativeTime('2026-10-01T10:00:00Z', now), 'ayer');
  assert.deepEqual(parseList('Operario, bodeguero\nOperario\n\n  guardia  ;cajero'), ['Operario', 'bodeguero', 'guardia', 'cajero']);
});
