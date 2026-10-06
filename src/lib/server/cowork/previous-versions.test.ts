import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCoworkHistoryFeedback, loadCoworkPreviousVersions } from './previous-versions';
import { coworkAnswerFeedback } from '@/lib/cowork/previous-versions';

const scope = { userId: 'u1', organizationId: 'o1' };
type Row = Record<string, unknown>;

/** Three tables in memory with the filters the loader uses; every query is checked to be scoped to the person. */
function db(tables: Record<string, Row[]>) {
  const unscoped: string[] = [];
  const client = { from(table: string) {
    const tests: Array<(row: Row) => boolean> = [];
    let ordered: { key: string; ascending: boolean } | null = null;
    let limit = Infinity;
    const scoped = () => tests.length >= 2;
    const chain: Record<string, (...args: any[]) => unknown> = {
      select: () => chain,
      eq: (key: string, value: unknown) => { tests.push(row => row[key] === value); return chain; },
      neq: (key: string, value: unknown) => { tests.push(row => row[key] !== value); return chain; },
      lt: (key: string, value: string) => { tests.push(row => String(row[key]) < value); return chain; },
      gte: (key: string, value: string) => { tests.push(row => String(row[key]) >= value); return chain; },
      is: (key: string, value: unknown) => { tests.push(row => (row[key] ?? null) === value); return chain; },
      in: (key: string, values: unknown[]) => { tests.push(row => values.includes(row[key])); return chain; },
      order: (key: string, options: { ascending: boolean }) => { ordered = { key, ascending: options.ascending }; return chain; },
      limit: (value: number) => { limit = value; return chain; },
      then: (resolve: (value: unknown) => void) => {
        if (!scoped()) unscoped.push(table);
        let rows = (tables[table] || []).filter(row => row.user_id === 'u1' && row.organization_id === 'o1' && tests.every(check => check(row)));
        if (ordered) { const { key, ascending } = ordered; rows = rows.sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1) * (ascending ? 1 : -1)); }
        resolve({ data: rows.slice(0, limit), error: null });
      },
    };
    return chain;
  } } as unknown as SupabaseClient;
  return { client, unscoped };
}

const mine = { user_id: 'u1', organization_id: 'o1' };
const run = (id: string, minute: number, extra: Row = {}): Row => ({ ...mine, id, message: 'escríbele a Jose', status: 'completed', parent_run_id: 'p',
  request_id: null, created_at: `2026-10-06T12:${String(minute).padStart(2, '0')}:00Z`, ...extra });
const event = (runId: string, sequence: number, kind: string, payload: Row) => ({ ...mine, run_id: runId, sequence, kind, payload });

test('another version reads the earlier answers to the same message, newest first, with the 👎 and its reason', async () => {
  const { client, unscoped } = db({
    cowork_runs: [run('v1', 1), run('v2', 2), run('v3', 3), run('other', 2, { message: 'otra cosa' }), run('failed', 2, { status: 'failed' }),
      run('elsewhere', 2, { parent_run_id: 'q' }), run('theirs', 2, { user_id: 'u2' })],
    cowork_run_events: [
      event('v1', 1, 'run.completed', { reply: 'Primera versión, muy larga' }),
      event('v2', 2, 'run.completed', { reply: 'Segunda versión' }),
      event('v2', 3, 'answer.feedback', { rating: 'down', reason: 'too_long', comment: 'más corto' }),
    ],
  });
  const versions = await loadCoworkPreviousVersions(client, scope, { id: 'v3', message: 'escríbele a Jose', parent_run_id: 'p', created_at: '2026-10-06T12:03:00Z' });
  assert.deepEqual(versions, [
    { reply: 'Segunda versión', feedback: { rating: 'down', reason: 'Demasiado largo', comment: 'más corto' } },
    { reply: 'Primera versión, muy larga', feedback: null },
  ]);
  assert.deepEqual(unscoped, []);
});

test('the first message asked again counts only the conversation it replaced (hidden, within the hour)', async () => {
  const root = (id: string, minute: number) => run(id, minute, { parent_run_id: null, message: '¿qué toca hoy?' });
  const { client } = db({
    cowork_runs: [root('old', 1), root('replaced', 30), root('kept', 40), { ...root('yesterday', 0), created_at: '2026-10-05T12:00:00Z' }],
    cowork_thread_settings: [{ ...mine, root_run_id: 'replaced', hidden_at: '2026-10-06T12:50:00Z' }, { ...mine, root_run_id: 'yesterday', hidden_at: '2026-10-05T13:00:00Z' }],
    cowork_run_events: [event('replaced', 1, 'run.completed', { reply: 'Hoy tienes 3 pendientes.' }), event('kept', 2, 'run.completed', { reply: 'x' })],
  });
  const versions = await loadCoworkPreviousVersions(client, scope, { id: 'new', message: '¿qué toca hoy?', parent_run_id: null, created_at: '2026-10-06T12:50:00Z' });
  assert.deepEqual(versions.map(version => version.reply), ['Hoy tienes 3 pendientes.']);
});

test('what the person said about each answer of the history, in one read', async () => {
  const { client } = db({ cowork_run_events: [
    event('a', 1, 'answer.feedback', { rating: 'up' }), event('b', 2, 'answer.feedback', { rating: 'down', reason: 'wrong_data' }),
    event('b', 3, 'answer.feedback', { rating: null }), event('c', 4, 'answer.feedback', { rating: 'down', reason: 'not_useful', comment: null }),
  ] });
  const feedback = await loadCoworkHistoryFeedback(client, scope, ['a', 'b', 'c']);
  assert.deepEqual([...feedback.entries()], [['a', { rating: 'up', reason: null, comment: null }], ['c', { rating: 'down', reason: 'Poco útil', comment: null }]]);
  assert.equal((await loadCoworkHistoryFeedback(client, scope, [])).size, 0);
  assert.equal(coworkAnswerFeedback([{ kind: 'answer.feedback', payload: { rating: 'meh' } }]), null);
});
