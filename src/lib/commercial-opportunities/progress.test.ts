import assert from 'node:assert/strict';
import test from 'node:test';
import { OPENED_LIMIT, buildProgress, isResearching, markOpened, openedKey, parseOpened, progressChips } from './progress';

const NOW = Date.parse('2026-10-21T15:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

test('for each opportunity asked, the latest research job and the latest report; the rest are left out', () => {
  const progress = buildProgress(
    [{ opportunity_id: 'a', state: 'failed', updated_at: minutesAgo(90) }, { opportunity_id: 'a', state: 'running', updated_at: minutesAgo(2) },
      { opportunity_id: 'b', state: 'ready', updated_at: minutesAgo(30) }, { opportunity_id: 'z', state: 'running', updated_at: minutesAgo(1) },
      { opportunity_id: 'c', state: 'strange', updated_at: minutesAgo(1) }, { opportunity_id: null, state: 'running', updated_at: minutesAgo(1) }],
    [{ opportunity_id: 'a', created_at: minutesAgo(600) }, { opportunity_id: 'a', created_at: minutesAgo(300) }, { opportunity_id: 'd', created_at: minutesAgo(10) },
      { opportunity_id: 'q', created_at: minutesAgo(10) }, { opportunity_id: 'b', created_at: 'not a date' }],
    ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(progress, {
    a: { research: 'running', researchAt: minutesAgo(2), reportAt: minutesAgo(300) },
    b: { research: 'ready', researchAt: minutesAgo(30) },
    d: { reportAt: minutesAgo(10) },
  });
  assert.deepEqual(buildProgress([], [], ['a']), {});
  assert.deepEqual(buildProgress([{ opportunity_id: 'a', state: 'ready', updated_at: null }], [], ['a']), { a: { research: 'ready', researchAt: null } });
});

test('only queued, running and waiting count as being researched', () => {
  for (const research of ['queued', 'running', 'waiting'] as const) assert.equal(isResearching({ research }), true, research);
  for (const research of ['ready', 'failed', 'blocked', null, undefined] as const) assert.equal(isResearching({ research }), false, String(research));
  assert.equal(isResearching(null), false);
  assert.equal(isResearching(undefined), false);
});

test('the card says first what its work is doing and then when this person opened it, with the same words everywhere', () => {
  const chips = (progress: Parameters<typeof progressChips>[0], openedAt?: number | null) => progressChips(progress, openedAt, NOW).map(chip => `${chip.key}|${chip.tone}|${chip.label}`);
  assert.deepEqual(chips({ research: 'running', researchAt: minutesAgo(2) }), ['research|active|Investigando…']);
  assert.match(progressChips({ research: 'queued', researchAt: minutesAgo(2) }, null, NOW)[0].title, /empezó hace 2 min/);
  assert.deepEqual(chips({ research: 'running', researchAt: minutesAgo(2), reportAt: minutesAgo(600) }), ['research|active|Investigando…'], 'a new research over an old report says it is researching');
  assert.deepEqual(chips({ research: 'ready', researchAt: minutesAgo(5), reportAt: minutesAgo(3) }), ['report|done|Informe listo · hace 3 min']);
  assert.deepEqual(chips({ reportAt: minutesAgo(180) }), ['report|done|Informe listo · hace 3 h']);
  assert.deepEqual(chips({ research: 'ready' }), ['report|done|Informe listo']);
  assert.deepEqual(chips({ research: 'failed', researchAt: minutesAgo(5) }), ['research|warning|Investigación fallida']);
  assert.deepEqual(chips({ research: 'blocked', researchAt: minutesAgo(5) }), ['research|warning|Investigación detenida']);
  assert.deepEqual(chips(null, NOW - 60_000), ['opened|quiet|Abierta hace 1 min']);
  assert.deepEqual(chips(undefined, NOW - 10_000), ['opened|quiet|Abierta recién']);
  assert.deepEqual(chips(undefined, NOW - 26 * 3_600_000), ['opened|quiet|Abierta ayer']);
  assert.deepEqual(chips({ research: 'running', researchAt: minutesAgo(1) }, NOW - 120_000), ['research|active|Investigando…', 'opened|quiet|Abierta hace 2 min'], 'the state first');
  assert.deepEqual(chips(null, null), [], 'nothing to say: nothing shown');
  assert.deepEqual(chips({}, undefined), []);
  assert.deepEqual(chips(null, Number.NaN), []);
  assert.deepEqual(chips(null, NOW + 3_600_000), [], 'a time in the future (a wrong clock) says nothing');
});

test('what was opened is read back safely, kept per person and capped to the most recent', () => {
  assert.equal(openedKey('u1'), 'anton:opportunities-opened:u1');
  assert.equal(openedKey(null), 'anton:opportunities-opened:anon');
  assert.deepEqual(parseOpened('{"a":100,"b":"x","":5,"c":null}'), { a: 100 });
  for (const broken of [null, undefined, '', 'not json', '[1,2]', '"text"', '5']) assert.deepEqual(parseOpened(broken as any), {}, String(broken));
  assert.deepEqual(markOpened({ a: 1 }, 'b', 50), { a: 1, b: 50 });
  assert.deepEqual(markOpened({ a: 1 }, 'a', 50), { a: 50 }, 'opened again: the new time');
  const many = Object.fromEntries(Array.from({ length: OPENED_LIMIT }, (_, index) => [`old${index}`, index + 1]));
  const capped = markOpened(many, 'fresh', 999_999);
  assert.equal(Object.keys(capped).length, OPENED_LIMIT);
  assert.equal(capped.fresh, 999_999);
  assert.equal('old0' in capped, false, 'the oldest one goes');
});
