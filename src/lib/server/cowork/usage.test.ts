import assert from 'node:assert/strict';
import test from 'node:test';

import { getCoworkUsage } from './usage';

const USER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const ROOT = '00000000-0000-4000-8000-0000000000a1';
const NEXT = '00000000-0000-4000-8000-0000000000a2';
const OTHER = '00000000-0000-4000-8000-0000000000b1';

/** The ledger as the person reads it (RLS: only their own calls), and what each read asked for. */
function ledger(calls: Array<{ run_id: string; output_reserved: number; created_at: string }>) {
  const asked: Array<{ table: string; filters: string[] }> = [];
  const from = (table: string) => {
    const filters: string[] = [];
    asked.push({ table, filters });
    const chain: any = {
      select: () => chain, limit: () => chain,
      eq: (column: string, value: string) => { filters.push(`${column}=${value}`); return chain; },
      or: (value: string) => { filters.push(`or=${value}`); return chain; },
      then: (resolve: (value: unknown) => void) => resolve(table === 'cowork_runs'
        ? { data: [{ id: ROOT }, { id: NEXT }], error: null }
        : { data: calls, error: null }),
    };
    return chain;
  };
  return { asked, auth: { supabase: { from }, user: { id: USER }, organizationId: ORG } as any };
}

test('the conversation counts its own turns, the day counts every call since midnight in Chile', async () => {
  const previous = process.env.COWORK_MODEL_BUDGET_ENABLED;
  process.env.COWORK_MODEL_BUDGET_ENABLED = 'true';
  try {
    // 22:00 in Santiago (UTC-3) on 24 October: the day started at 03:00 UTC.
    const now = new Date('2026-10-25T01:00:00Z');
    const { asked, auth } = ledger([
      // Yesterday, in this conversation: counts for it, not for today.
      ...Array.from({ length: 100 }, () => ({ run_id: ROOT, output_reserved: 1500, created_at: '2026-10-24T02:00:00Z' })),
      // Today, in this conversation and in another one.
      ...Array.from({ length: 60 }, () => ({ run_id: NEXT, output_reserved: 1500, created_at: '2026-10-24T15:00:00Z' })),
      ...Array.from({ length: 30 }, () => ({ run_id: OTHER, output_reserved: 6000, created_at: '2026-10-24T20:00:00Z' })),
    ]);
    const usage = await getCoworkUsage(auth, ROOT, now);
    assert.deepEqual(usage, { conversation: 0.8, today: 0.3 });
    assert.deepEqual(asked[0], { table: 'cowork_runs', filters: [`root_run_id=${ROOT}`, `user_id=${USER}`, `organization_id=${ORG}`] });
    assert.deepEqual(asked[1].filters, [`user_id=${USER}`, `or=created_at.gte."2026-10-24T03:00:00.000Z",run_id.in.(${ROOT},${NEXT})`]);
  } finally {
    if (previous === undefined) delete process.env.COWORK_MODEL_BUDGET_ENABLED; else process.env.COWORK_MODEL_BUDGET_ENABLED = previous;
  }
});

test('without the ledger there is no cap, and nothing to show', async () => {
  const previous = process.env.COWORK_MODEL_BUDGET_ENABLED;
  delete process.env.COWORK_MODEL_BUDGET_ENABLED;
  try {
    const { asked, auth } = ledger([]);
    assert.equal(await getCoworkUsage(auth, ROOT), null);
    assert.equal(asked.length, 0);
  } finally {
    if (previous !== undefined) process.env.COWORK_MODEL_BUDGET_ENABLED = previous;
  }
});
