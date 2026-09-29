import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reserveCoworkModelCall } from './model-budget';

/** A ledger that knows the roles in `known`, as the database does before or after 20260928030000. */
function ledger(known: string[]) {
  const roles: string[] = [];
  const client = {
    rpc: async (_name: string, params: { p_role: string }) => {
      roles.push(params.p_role);
      return known.includes(params.p_role) ? { data: `call-${params.p_role}`, error: null }
        : { data: null, error: { message: params.p_role === 'boss' || params.p_role === 'coordinator' ? 'Model budget exhausted' : 'Specialist attempt unavailable' } };
    },
  } as unknown as SupabaseClient;
  return { client, roles };
}

test('the in-turn agents reserve their own role, or the coordinator\'s until the ledger knows them', async () => {
  const previous = process.env.COWORK_MODEL_BUDGET_ENABLED;
  process.env.COWORK_MODEL_BUDGET_ENABLED = 'true';
  try {
    const after = ledger(['coordinator', 'writer', 'reviewer', 'judge']);
    assert.equal(await reserveCoworkModelCall(after.client, 'run', 'token', 'writer'), 'call-writer');
    assert.deepEqual(after.roles, ['writer']);
    const before = ledger(['coordinator']);
    assert.equal(await reserveCoworkModelCall(before.client, 'run', 'token', 'reviewer'), 'call-coordinator');
    assert.deepEqual(before.roles, ['reviewer', 'coordinator']);
    // A specialist never falls back, and an exhausted budget is not retried under another role.
    const specialists = ledger(['coordinator']);
    await assert.rejects(reserveCoworkModelCall(specialists.client, 'run', 'token', 'analyst', 'task'), /No se pudo reservar/);
    assert.deepEqual(specialists.roles, ['analyst']);
    const exhausted = ledger([]);
    await assert.rejects(reserveCoworkModelCall(exhausted.client, 'run', 'token', 'writer'), /No se pudo reservar/);
    assert.deepEqual(exhausted.roles, ['writer', 'coordinator']);
  } finally {
    if (previous === undefined) delete process.env.COWORK_MODEL_BUDGET_ENABLED; else process.env.COWORK_MODEL_BUDGET_ENABLED = previous;
  }
});

test('without the budget flag nothing is reserved', async () => {
  const previous = process.env.COWORK_MODEL_BUDGET_ENABLED;
  delete process.env.COWORK_MODEL_BUDGET_ENABLED;
  try {
    const off = ledger(['coordinator']);
    assert.equal(await reserveCoworkModelCall(off.client, 'run', 'token', 'writer'), undefined);
    assert.deepEqual(off.roles, []);
  } finally {
    if (previous !== undefined) process.env.COWORK_MODEL_BUDGET_ENABLED = previous;
  }
});
