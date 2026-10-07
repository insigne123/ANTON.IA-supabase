import test from 'node:test';
import assert from 'node:assert/strict';
import { SEIA_REMINDER_DAYS, filterOpportunities, formatDay, formatUsd, lastSearch, parseList, relativeTime, seiaReminderDays, statusCounts } from './view';

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

test('the SEIA file is reminded from its 30th day, never without a file or with an unreadable date', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  assert.equal(SEIA_REMINDER_DAYS, 30);
  assert.equal(seiaReminderDays(null, now), null);
  assert.equal(seiaReminderDays('no es fecha', now), null);
  assert.equal(seiaReminderDays('2026-09-06T13:00:00Z', now), null, '29 days: not yet');
  assert.equal(seiaReminderDays('2026-09-05T12:00:00Z', now), 30);
  assert.equal(seiaReminderDays('2026-08-20T12:00:00Z', '2026-10-05T12:00:00Z'), 46, 'the date can come as text, as Cowork passes it');
});

test('«Nueva» is what appeared since the previous visit, and reloading in the same sitting keeps the badges', async () => {
  const { opportunitiesVisit, isNewSince, FILTER_LABELS } = await import('./view');
  const first = opportunitiesVisit(null, '2026-10-08T10:00:00.000Z');
  assert.equal(first.newSince, '2026-10-06T10:00:00.000Z', 'the first time, the last two days');
  assert.deepEqual(first.next, { at: '2026-10-08T10:00:00.000Z', since: '2026-10-06T10:00:00.000Z' });
  const reload = opportunitiesVisit(first.next, '2026-10-08T10:20:00.000Z');
  assert.equal(reload.newSince, first.newSince, 'the same sitting');
  const later = opportunitiesVisit(reload.next, '2026-10-08T15:00:00.000Z');
  assert.equal(later.newSince, '2026-10-08T10:20:00.000Z', 'the next visit: what appeared after the previous one');
  assert.deepEqual(later.next, { at: '2026-10-08T15:00:00.000Z', since: '2026-10-08T10:20:00.000Z' });
  assert.equal(opportunitiesVisit(later.next, '2026-10-08T15:05:00.000Z').newSince, '2026-10-08T10:20:00.000Z');
  assert.equal(opportunitiesVisit({ at: 'nada' }, '2026-10-08T10:00:00.000Z').newSince, '2026-10-06T10:00:00.000Z', 'anything malformed is a first visit');
  assert.equal(isNewSince('2026-10-08T11:00:00Z', '2026-10-08T10:20:00Z'), true);
  assert.equal(isNewSince('2026-10-08T09:00:00Z', '2026-10-08T10:20:00Z'), false);
  assert.equal(isNewSince(null, '2026-10-08T10:20:00Z'), false);
  assert.equal(FILTER_LABELS.new, 'Por revisar', '«Nueva» is the badge now; the status reads «Por revisar»');
});
