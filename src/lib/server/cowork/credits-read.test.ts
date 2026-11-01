import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkCredits } from './credits-read';

const now = Date.parse('2026-09-30T18:00:00Z');
const balance = (capturedAt: string, remaining = 1840) => ({ remaining, used: 2_500 - remaining, limit: 2_500, cycleEnd: '2026-10-15T00:00:00Z', capturedAt });

test('the balance comes with what each enrichment costs and how many each kind affords', async () => {
  const result = await readCoworkCredits(async () => balance('2026-09-30T17:00:00Z'), now) as any;
  assert.equal(result.available, true);
  assert.equal(result.remaining, 1840);
  assert.deepEqual(result.costs, { emailEnrichment: 1, phoneEnrichment: 8 });
  assert.deepEqual(result.affords, { emailEnrichments: 1840, phoneReveals: 230 });
  assert.equal(result.stale, false);
  assert.equal(result.ageHours, 1);
});

test('a snapshot of hours ago says it is stale and how old it is', async () => {
  const result = await readCoworkCredits(async () => balance('2026-09-30T09:00:00Z', 95), now) as any;
  assert.equal(result.stale, true);
  assert.equal(result.ageHours, 9);
  assert.deepEqual(result.affords, { emailEnrichments: 95, phoneReveals: 11 });
});

test('with no balance, or one that cannot be read, it gives the costs and claims nothing', async () => {
  for (const load of [async () => null, async () => { throw new Error('db down: secret detail'); }]) {
    const result = await readCoworkCredits(load, now) as any;
    assert.equal(result.available, false);
    assert.deepEqual(result.costs, { emailEnrichment: 1, phoneEnrichment: 8 });
    assert.equal('remaining' in result, false);
    assert.doesNotMatch(JSON.stringify(result), /secret detail/);
  }
});

test('with an organization share it says what is left of it and what it affords, apart from the shared balance', async () => {
  const share = { credits: 300, used: 18, remaining: 282, startsAt: '2026-10-28T20:00:00Z', endsAt: '2026-11-01T20:17:52Z', note: null, usedBefore: 2300, showLimit: true };
  const result = await readCoworkCredits(async () => balance('2026-09-30T17:00:00Z', 1000), now, async () => share) as any;
  assert.equal(result.remaining, 1000, 'the shared balance stays as it is');
  assert.deepEqual(result.organizationShare, { usedThisCycle: 2318, remaining: 282, until: '1 de noviembre',
    costs: { emailEnrichment: 1, phoneEnrichment: 8 }, affords: { emailEnrichments: 282, phoneReveals: 35 } });
  assert.match(result.limitation, /organizationShare/);
  const unread = await readCoworkCredits(async () => null, now, async () => share) as any;
  assert.equal(unread.available, false);
  assert.equal(unread.organizationShare.remaining, 282);
  const failing = await readCoworkCredits(async () => balance('2026-09-30T17:00:00Z'), now, async () => { throw new Error('db down'); }) as any;
  assert.equal('organizationShare' in failing, false);
  assert.doesNotMatch(failing.limitation, /organizationShare/);
});

test('an organization that does not see its share reads only what it used', async () => {
  const share = { credits: 700, used: 50, remaining: 650, startsAt: '2026-10-28T20:00:00Z', endsAt: '2026-11-01T20:17:52Z', note: null, usedBefore: 29, showLimit: false };
  const result = await readCoworkCredits(async () => balance('2026-09-30T17:00:00Z', 1000), now, async () => share) as any;
  assert.deepEqual(result.organizationShare, { usedThisCycle: 79, until: '1 de noviembre', costs: { emailEnrichment: 1, phoneEnrichment: 8 } });
  assert.doesNotMatch(JSON.stringify(result.organizationShare), /700|650/);
});
