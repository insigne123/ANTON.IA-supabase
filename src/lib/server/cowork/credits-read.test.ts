import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkCredits } from './credits-read';

const now = Date.parse('2026-09-30T18:00:00Z');
const balance = (capturedAt: string, remaining = 1840) => ({ remaining, used: 2_500 - remaining, limit: 2_500, cycleEnd: '2026-10-15T00:00:00Z', capturedAt });

test('the balance comes with what each enrichment costs and how many each kind affords', async () => {
  const result = await readCoworkCredits(async () => balance('2026-09-30T17:00:00Z'), now) as any;
  assert.equal(result.available, true);
  assert.equal(result.remaining, 1840);
  assert.deepEqual(result.costs, { emailEnrichment: 1, phoneEnrichment: 10 });
  assert.deepEqual(result.affords, { emailEnrichments: 1840, phoneReveals: 184 });
  assert.equal(result.stale, false);
  assert.equal(result.ageHours, 1);
});

test('a snapshot of hours ago says it is stale and how old it is', async () => {
  const result = await readCoworkCredits(async () => balance('2026-09-30T09:00:00Z', 95), now) as any;
  assert.equal(result.stale, true);
  assert.equal(result.ageHours, 9);
  assert.deepEqual(result.affords, { emailEnrichments: 95, phoneReveals: 9 });
});

test('with no balance, or one that cannot be read, it gives the costs and claims nothing', async () => {
  for (const load of [async () => null, async () => { throw new Error('db down: secret detail'); }]) {
    const result = await readCoworkCredits(load, now) as any;
    assert.equal(result.available, false);
    assert.deepEqual(result.costs, { emailEnrichment: 1, phoneEnrichment: 10 });
    assert.equal('remaining' in result, false);
    assert.doesNotMatch(JSON.stringify(result), /secret detail/);
  }
});
