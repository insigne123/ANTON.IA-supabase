import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZodError } from 'zod';

import { groupCoworkThreads } from '@/lib/cowork/presentation';
import type { CoworkRun } from '@/lib/cowork/contracts';
import { CoworkThreadError, normalizeCoworkThreadTitle, readCoworkThreadSettings, updateCoworkThread } from './thread-settings';

type Row = Record<string, any>;
const USER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const ROOT = '00000000-0000-4000-8000-0000000000a1';
const FOLLOW = '00000000-0000-4000-8000-0000000000a2';
const scope = { userId: USER, organizationId: ORG };
const NOW = new Date('2026-10-04T12:00:00.000Z');

/** Just enough of the query builder: select/eq/in/order/limit, maybeSingle, head counts and upsert().select().single(). */
function fakeClient(tables: Record<string, Row[]>, { error }: { error?: { code?: string; message: string } } = {}) {
  const log: Array<{ table: string; op: string; row?: Row }> = [];
  const client = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let head = false;
      let upserted: Row | null = null;
      const rows = () => (tables[table] || []).filter((row) => filters.every((keep) => keep(row)));
      const builder: any = {
        select(_columns?: string, options?: { head?: boolean }) { head = Boolean(options?.head); return builder; },
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder; },
        in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return builder; },
        order() { return builder; },
        limit() { return builder; },
        upsert(row: Row) {
          log.push({ table, op: 'upsert', row });
          const existing = (tables[table] ||= []).find((item) => item.root_run_id === row.root_run_id);
          upserted = existing ? Object.assign(existing, row) : { title: null, hidden_at: null, ...row };
          if (!existing) tables[table].push(upserted);
          return builder;
        },
        maybeSingle: async () => (error ? { data: null, error } : { data: rows()[0] ?? null, error: null }),
        single: async () => (error ? { data: null, error } : { data: upserted, error: null }),
        then(resolve: (value: unknown) => void) {
          if (error) return resolve({ data: null, error });
          if (head) return resolve({ count: rows().length, error: null });
          resolve({ data: rows(), error: null });
        },
      };
      return builder;
    },
  };
  return { client, log };
}

const runs = (status = 'completed') => ({
  cowork_runs: [
    { id: ROOT, root_run_id: ROOT, user_id: USER, organization_id: ORG, status: 'completed' },
    { id: FOLLOW, root_run_id: ROOT, user_id: USER, organization_id: ORG, status },
  ],
});

test('a name is trimmed with its spaces collapsed, empty goes back to the first message, and 120 characters is the limit', () => {
  assert.equal(normalizeCoworkThreadTitle('  Clínicas   de Santiago '), 'Clínicas de Santiago');
  assert.equal(normalizeCoworkThreadTitle('   '), null);
  assert.equal(normalizeCoworkThreadTitle(null), null);
  assert.equal(normalizeCoworkThreadTitle('a'.repeat(120))?.length, 120);
  assert.throws(() => normalizeCoworkThreadTitle('a'.repeat(121)), ZodError);
});

test('the settings give the hidden conversations and the names; without the table they are just unavailable', async () => {
  const { client } = fakeClient({ cowork_thread_settings: [
    { root_run_id: ROOT, user_id: USER, organization_id: ORG, title: 'Clínicas', hidden_at: null },
    { root_run_id: FOLLOW, user_id: USER, organization_id: ORG, title: null, hidden_at: '2026-10-03T00:00:00Z' },
    { root_run_id: 'other', user_id: 'someone-else', organization_id: ORG, title: 'Ajeno', hidden_at: '2026-10-03T00:00:00Z' },
  ] });
  assert.deepEqual(await readCoworkThreadSettings(client, scope), { available: true, hiddenRootIds: [FOLLOW], titles: { [ROOT]: 'Clínicas' } });
  const missing = fakeClient({}, { error: { code: 'PGRST205', message: "Could not find the table 'public.cowork_thread_settings'" } });
  assert.deepEqual(await readCoworkThreadSettings(missing.client, scope), { available: false, hiddenRootIds: [], titles: {} });
  const broken = fakeClient({}, { error: { code: '57014', message: 'canceling statement due to statement timeout' } });
  await assert.rejects(readCoworkThreadSettings(broken.client, scope));
});

test('renaming checks the conversation is yours and a root, then the server writes only the name', async () => {
  const user = fakeClient(runs());
  const admin = fakeClient({ cowork_thread_settings: [] });
  const saved = await updateCoworkThread(user.client, admin.client, scope, ROOT, { title: '  Clínicas  ' }, NOW);
  assert.deepEqual(saved, { rootRunId: ROOT, title: 'Clínicas', hiddenAt: null });
  assert.deepEqual(admin.log[0].row, { root_run_id: ROOT, user_id: USER, organization_id: ORG, updated_at: NOW.toISOString(), title: 'Clínicas' });
  await assert.rejects(updateCoworkThread(user.client, admin.client, scope, FOLLOW, { title: 'x' }, NOW), (error: unknown) => error instanceof CoworkThreadError && error.code === 'NOT_FOUND');
  const stranger = fakeClient(runs());
  await assert.rejects(updateCoworkThread(stranger.client, admin.client, { userId: 'someone-else', organizationId: ORG }, ROOT, { title: 'x' }, NOW), CoworkThreadError);
  await assert.rejects(updateCoworkThread(user.client, admin.client, scope, 'not-a-uuid', { title: 'x' }, NOW), ZodError);
  await assert.rejects(updateCoworkThread(user.client, admin.client, scope, ROOT, {}, NOW), ZodError);
  await assert.rejects(updateCoworkThread(user.client, admin.client, scope, ROOT, { title: 'x', extra: true }, NOW), ZodError);
});

test('deleting hides a finished conversation and «Deshacer» shows it again; a working one cannot be deleted', async () => {
  const admin = fakeClient({ cowork_thread_settings: [] });
  const busy = fakeClient(runs('running'));
  await assert.rejects(updateCoworkThread(busy.client, admin.client, scope, ROOT, { hidden: true }, NOW), (error: unknown) => error instanceof CoworkThreadError && error.code === 'ACTIVE');
  assert.equal(admin.log.length, 0, 'nothing written while it works');
  const waiting = fakeClient(runs('waiting_approval'));
  await assert.rejects(updateCoworkThread(waiting.client, admin.client, scope, ROOT, { hidden: true }, NOW), CoworkThreadError);

  const done = fakeClient(runs('completed'));
  const hidden = await updateCoworkThread(done.client, admin.client, scope, ROOT, { hidden: true }, NOW);
  assert.equal(hidden.hiddenAt, NOW.toISOString());
  const back = await updateCoworkThread(done.client, admin.client, scope, ROOT, { hidden: false }, NOW);
  assert.equal(back.hiddenAt, null);
  assert.equal(admin.log[1].row?.hidden_at, null);
  assert.equal('title' in (admin.log[1].row || {}), false, 'undoing keeps the name');

  const missing = fakeClient({}, { error: { code: '42P01', message: 'relation "public.cowork_thread_settings" does not exist' } });
  await assert.rejects(updateCoworkThread(done.client, missing.client, scope, ROOT, { hidden: true }, NOW), (error: unknown) => error instanceof CoworkThreadError && error.code === 'UNAVAILABLE');
});

test('the list groups by root_run_id even when the first run is older than the list, and shows the given name', () => {
  const run = (id: string, minute: number, extra: Partial<CoworkRun> = {}): CoworkRun => ({
    id, message: `Mensaje ${id}`, mode: 'approval', status: 'completed', created_at: `2026-10-04T10:${String(minute).padStart(2, '0')}:00Z`, ...extra,
  });
  // The root is not in the list: before root_run_id each follow-up looked like its own conversation.
  const threads = groupCoworkThreads([
    run('b', 2, { parent_run_id: 'gone', root_run_id: 'gone' }),
    run('c', 5, { parent_run_id: 'b', root_run_id: 'gone' }),
    run('d', 7, { root_run_id: 'd' }),
  ], { gone: 'Clínicas de Santiago' });
  assert.deepEqual(threads.map((thread) => [thread.rootId, thread.title, thread.turns]), [['d', 'Mensaje d', 1], ['gone', 'Clínicas de Santiago', 2]]);
});

test('the route, the list and the workspace wire rename and delete, and hide the menu without the table', () => {
  const route = readFileSync('src/app/api/cowork/threads/[rootId]/route.ts', 'utf8');
  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function DELETE[\s\S]*change\(rootId, \{ hidden: true \}\)/);
  assert.match(route, /requireCoworkAccess\(\)/);
  assert.match(route, /ACTIVE: \{ status: 409/);
  const list = readFileSync('src/app/api/cowork/runs/route.ts', 'utf8');
  assert.match(list, /listCoworkRuns\(auth, \{ hiddenRootIds: threads\.hiddenRootIds \}\)/);
  assert.match(list, /threads: \{ available: threads\.available, titles: threads\.titles \}/);
  const menu = readFileSync('src/components/cowork/CoworkThreadList.tsx', 'utf8');
  assert.match(menu, /Renombrar/);
  assert.match(menu, /disabled=\{working\}/);
  assert.match(menu, /maxLength=\{TITLE_MAX\}/);
  const workspace = readFileSync('src/components/cowork/CoworkWorkspace.tsx', 'utf8');
  assert.match(workspace, /const threadActions = threadNames\.available/);
  assert.match(workspace, /<ToastAction altText="Deshacer la eliminación"/);
  assert.equal((workspace.match(/\{\.\.\.threadActions\}/g) || []).length, 2, 'the rail and the phone drawer');
});
