import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('src/lib/server/mailbox-sweep.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(contactCount: number, failAt = -1) {
  const writes: Array<Record<string, unknown>> = [];
  let synced = 0;
  const contacts = Array.from({ length: contactCount }, (_, index) => ({
    id: `c${index}`, email: 'lead@example.test', sent_at: '2026-09-01T00:00:00Z',
  }));
  const exports: any = {};
  const modules: Record<string, unknown> = {
    './reply-sync': {
      mailboxAccessToken: async () => 'token',
      normalizeEmail: (value: string) => value.toLowerCase(),
      extractEmailAddress: (value: string) => value,
      syncSingleContactRow: async () => {
        synced++;
        return { synced: 0, state: synced === failAt ? 'sync_failed' : 'ok' };
      },
    },
    './reply-sync-policy': {
      mailboxSweepDue: () => ({ due: true, reason: 'never_swept' }),
      SWEEP_MATCH_BUDGET: 5, SWEEP_PAGE_BUDGET: 2, SWEEP_WINDOW_DAYS: 30,
    },
  };
  new Function('require', 'exports', compiled)((name: string) => modules[name], exports);
  const supabase = { from(table: string) {
    if (table === 'cowork_mailbox_sweep_state') return {
      select() { return this; }, eq() { return this; }, limit: async () => ({ data: [], error: null }),
      upsert: async (row: Record<string, unknown>) => { writes.push(row); return { error: null }; },
    };
    if (table === 'contacted_leads') return {
      select() { return this; }, eq() { return this; }, not() { return this; }, gte() { return this; }, order() { return this; },
      limit: async () => ({ data: contacts, error: null }),
    };
    throw new Error(`Unexpected table ${table}`);
  } };
  return { sweep: () => exports.sweepMailboxForOwner(supabase, { organizationId: 'org', userId: 'user', provider: 'gmail' }, Date.parse('2026-09-23T00:00:00Z')), writes, getSynced: () => synced };
}

test('mailbox sweep never completes a page whose matches exceed its processing budget', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async (url: any) => String(url).includes('/messages?')
    ? Response.json({ messages: [{ id: 'm1' }] })
    : Response.json({ id: 'm1', internalDate: String(Date.parse('2026-09-22T00:00:00Z')), payload: { headers: [{ name: 'From', value: 'lead@example.test' }] } }));
  const fixture = harness(6);
  const result = await fixture.sweep();
  assert.equal(result.completedWindow, false);
  assert.equal(result.error, 'sweep_match_budget_exceeded');
  assert.equal(fixture.getSynced(), 0);
  assert.equal(fixture.writes.some((write) => write.last_completed_at), false);
  mock.mock.restore();
});

test('mailbox sweep only reports coverage after all matches have synced', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async (url: any) => String(url).includes('/messages?')
    ? Response.json({ messages: [{ id: 'm1' }] })
    : Response.json({ id: 'm1', internalDate: String(Date.parse('2026-09-22T00:00:00Z')), payload: { headers: [{ name: 'From', value: 'lead@example.test' }] } }));
  const failed = harness(2, 2);
  const result = await failed.sweep();
  assert.equal(result.completedWindow, false);
  assert.equal(result.error, 'sync_failed');
  assert.equal(failed.writes.some((write) => write.last_completed_at), false);
  const succeeded = harness(2);
  assert.equal((await succeeded.sweep()).completedWindow, true);
  assert.equal(succeeded.writes.some((write) => write.last_completed_at), true);
  mock.mock.restore();
});
