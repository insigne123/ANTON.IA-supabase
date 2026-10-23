import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { ZodError } from 'zod';
import { COWORK_SCHEDULE_MARK } from '@/lib/cowork/schedules';
import {
  CoworkScheduleError, coworkSchedulesEnabled, createCoworkSchedule, deleteCoworkSchedule, listCoworkSchedules, processCoworkSchedules,
  resetCoworkSchedulePassForTests, runCoworkScheduleNow, updateCoworkSchedule,
} from './schedules';

type Row = Record<string, any>;
const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-0000000000ff';
const ORG = '00000000-0000-4000-8000-000000000002';
const scope = { userId: USER, organizationId: ORG };
const NOW = new Date('2026-10-26T12:00:30.000Z'); // Monday 09:00:30 in Chile (UTC-3)
const ID = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const input = { title: 'Resumen del lunes', prompt: 'Dime quién respondió esta semana y a quién escribir hoy.', frequency: 'weekly', time: '09:00', weekday: 1 };

/** Just enough of the query builder for this table: select/insert/update/delete with eq, neq, lte, order and limit, and the rpc that admits a run. */
function fakeClient(rows: Row[] = [], options: { error?: { code?: string; message: string }; insertError?: { code?: string; message: string }; admit?: (args: Row) => { data: unknown; error: unknown } | void } = {}) {
  const admitted: Row[] = [];
  const writes: Array<{ op: string; row: Row }> = [];
  let sequence = rows.length;
  const client = {
    rows,
    admitted,
    writes,
    rpc(name: string, args: Row) {
      assert.equal(name, 'cowork_admit_run');
      admitted.push(args);
      const custom = options.admit?.(args);
      return Promise.resolve(custom ?? { data: `run-${admitted.length}`, error: null });
    },
    from(table: string) {
      assert.equal(table, 'cowork_scheduled_tasks');
      const filters: Array<(row: Row) => boolean> = [];
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let payload: Row = {};
      let head = false;
      let limit = Infinity;
      const matching = () => rows.filter(row => filters.every(keep => keep(row))).slice(0, limit);
      const run = () => {
        if (options.error) return { data: null, error: options.error };
        if (op === 'insert') {
          if (options.insertError) return { data: null, error: options.insertError };
          const row = { id: ID(++sequence), status: 'active', consecutive_failures: 0, run_count: 0, last_run_at: null, last_run_id: null, last_status: null, created_at: NOW.toISOString(), ...payload };
          writes.push({ op, row: payload });
          rows.push(row);
          return { data: { ...row }, error: null };
        }
        // Like the database, what comes back is a copy: a row someone else changes later is not the one this caller holds.
        if (op === 'update') {
          const found = matching();
          for (const row of found) Object.assign(row, payload);
          writes.push({ op, row: payload });
          return { data: found.map(row => ({ ...row })), error: null };
        }
        if (op === 'delete') {
          const found = matching();
          for (const row of found) rows.splice(rows.indexOf(row), 1);
          return { data: found.map(row => ({ ...row })), error: null };
        }
        const found = matching();
        return head ? { count: found.length, error: null } : { data: found.map(row => ({ ...row })), error: null };
      };
      const builder: any = {
        select(_columns?: string, selectOptions?: { head?: boolean }) { head = Boolean(selectOptions?.head); return builder; },
        insert(row: Row) { op = 'insert'; payload = row; return builder; },
        update(row: Row) { op = 'update'; payload = row; return builder; },
        delete() { op = 'delete'; return builder; },
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return builder; },
        neq(column: string, value: unknown) { filters.push(row => row[column] !== value); return builder; },
        lte(column: string, value: string) { filters.push(row => row[column] != null && Date.parse(row[column]) <= Date.parse(value)); return builder; },
        order() { return builder; },
        limit(count: number) { limit = count; return builder; },
        maybeSingle: async () => { const result: any = run(); return result.error ? result : { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null }; },
        single: async () => { const result: any = run(); return result.error ? result : { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null }; },
        then(resolve: (value: unknown) => void) { resolve(run()); },
      };
      return builder;
    },
  };
  return client;
}

const task = (n: number, overrides: Row = {}): Row => ({
  id: ID(n), user_id: USER, organization_id: ORG, title: `Tarea ${n}`, prompt: 'Dime quién respondió esta semana y a quién escribir hoy.',
  frequency: 'daily', time_of_day: '09:00', weekday: null, month_day: null, time_zone: 'America/Santiago', status: 'active',
  next_run_at: '2026-10-26T12:00:00+00:00', last_run_at: null, last_run_id: null, last_status: null, consecutive_failures: 0, run_count: 0,
  created_at: '2026-10-20T12:00:00+00:00', ...overrides,
});
const allowed = async () => undefined;
const revoked = async () => { throw new Error('Acceso Cowork revocado.'); };

beforeEach(() => resetCoworkSchedulePassForTests());

test('scheduled tasks are off unless COWORK_SCHEDULES_ENABLED=true', () => {
  assert.equal(coworkSchedulesEnabled({}), false);
  assert.equal(coworkSchedulesEnabled({ COWORK_SCHEDULES_ENABLED: 'yes' }), false);
  assert.equal(coworkSchedulesEnabled({ COWORK_SCHEDULES_ENABLED: 'true' }), true);
});

test('a task is created with its cadence checked, its next firing worked out and the owner set by the server', async () => {
  const client = fakeClient();
  const created = await createCoworkSchedule(client, scope, { ...input, title: '  Resumen del lunes ' }, { now: NOW });
  assert.equal(created.title, 'Resumen del lunes');
  assert.equal(created.description, 'Los lunes a las 09:00');
  assert.equal(created.status, 'active');
  assert.equal(created.nextRunAt, '2026-11-02T12:00:00.000Z', 'Monday 09:00 passed by 30 s: the next is next Monday');
  assert.deepEqual(client.writes[0].row, {
    user_id: USER, organization_id: ORG, title: 'Resumen del lunes', prompt: input.prompt, frequency: 'weekly', time_of_day: '09:00', weekday: 1, month_day: null,
    time_zone: 'America/Santiago', status: 'active', next_run_at: '2026-11-02T12:00:00.000Z', created_from_run_id: null,
  });
  await assert.rejects(createCoworkSchedule(client, scope, { ...input, weekday: null }, { now: NOW }), ZodError, 'a weekly task needs its day');
  await assert.rejects(createCoworkSchedule(client, scope, { ...input, owner: OTHER }, { now: NOW }), ZodError, 'the owner is not an input');
});

test('a person has at most five active tasks; a proposed one waits without a date and does not count', async () => {
  const client = fakeClient([1, 2, 3, 4, 5].map(n => task(n)));
  await assert.rejects(createCoworkSchedule(client, scope, input, { now: NOW }), (error: unknown) => error instanceof CoworkScheduleError && error.code === 'LIMIT');
  const proposed = await createCoworkSchedule(client, scope, input, { now: NOW, status: 'proposed', createdFromRunId: ID(90) });
  assert.equal(proposed.status, 'proposed');
  assert.equal(proposed.nextRunAt, null);
  assert.equal(client.writes[0].row.created_from_run_id, ID(90));
  const trigger = fakeClient([], { insertError: { code: '23514', message: 'Too many active scheduled tasks' } });
  await assert.rejects(createCoworkSchedule(trigger, scope, input, { now: NOW }), (error: unknown) => error instanceof CoworkScheduleError && error.code === 'LIMIT', 'the backstop in the database says the same');
  const missing = fakeClient([], { error: { code: 'PGRST205', message: "Could not find the table 'public.cowork_scheduled_tasks'" } });
  await assert.rejects(createCoworkSchedule(missing, scope, input, { now: NOW }), (error: unknown) => error instanceof CoworkScheduleError && error.code === 'UNAVAILABLE');
  const missingOnInsert = fakeClient([], { insertError: { code: '42P01', message: 'relation "public.cowork_scheduled_tasks" does not exist' } });
  await assert.rejects(createCoworkSchedule(missingOnInsert, scope, input, { now: NOW }), (error: unknown) => error instanceof CoworkScheduleError && error.code === 'UNAVAILABLE');
});

test('the list shows the person\'s tasks without the proposed ones; without the table it is just unavailable', async () => {
  const client = fakeClient([task(1), task(2, { status: 'paused', next_run_at: null }), task(3, { status: 'proposed', next_run_at: null }), task(4, { user_id: OTHER })]);
  const { available, tasks } = await listCoworkSchedules(client, scope);
  assert.equal(available, true);
  assert.deepEqual(tasks.map(item => [item.title, item.status]), [['Tarea 1', 'active'], ['Tarea 2', 'paused']]);
  assert.equal(tasks[0].description, 'Todos los días a las 09:00');
  const missing = fakeClient([], { error: { code: 'PGRST205', message: "Could not find the table 'public.cowork_scheduled_tasks' in the schema cache" } });
  assert.deepEqual(await listCoworkSchedules(missing, scope), { available: false, tasks: [] });
  const broken = fakeClient([], { error: { code: '57014', message: 'canceling statement due to statement timeout' } });
  await assert.rejects(listCoworkSchedules(broken, scope));
});

test('pausing clears the next firing; resuming starts again from now, with the count of failures at zero, and respects the limit', async () => {
  const client = fakeClient([task(1, { consecutive_failures: 2 })]);
  const paused = await updateCoworkSchedule(client, scope, ID(1), { enabled: false }, { now: NOW });
  assert.equal(paused.status, 'paused');
  assert.equal(paused.nextRunAt, null);
  const resumed = await updateCoworkSchedule(client, scope, ID(1), { enabled: true }, { now: NOW });
  assert.equal(resumed.status, 'active');
  assert.equal(resumed.nextRunAt, '2026-10-27T12:00:00.000Z');
  assert.equal(client.rows[0].consecutive_failures, 0);
  const full = fakeClient([...[1, 2, 3, 4, 5].map(n => task(n)), task(6, { status: 'paused', next_run_at: null })]);
  await assert.rejects(updateCoworkSchedule(full, scope, ID(6), { enabled: true }, { now: NOW }), (error: unknown) => error instanceof CoworkScheduleError && error.code === 'LIMIT');
});

test('changing the cadence moves the next firing; another frequency drops the day that no longer belongs; a rename keeps the date', async () => {
  const client = fakeClient([task(1, { frequency: 'weekly', weekday: 1 })]);
  const daily = await updateCoworkSchedule(client, scope, ID(1), { frequency: 'daily' }, { now: NOW });
  assert.equal(daily.weekday, null, 'weekday dropped with the weekly frequency');
  assert.equal(daily.nextRunAt, '2026-10-27T12:00:00.000Z');
  const kept = fakeClient([task(1, { next_run_at: '2026-10-27T12:00:00+00:00' })]);
  const renamed = await updateCoworkSchedule(kept, scope, ID(1), { title: 'Otro nombre' }, { now: NOW });
  assert.equal(renamed.title, 'Otro nombre');
  assert.equal(renamed.nextRunAt, '2026-10-27T12:00:00+00:00', 'a rename does not move the date');
  await assert.rejects(updateCoworkSchedule(kept, scope, ID(1), { frequency: 'weekly' }, { now: NOW }), ZodError, 'weekly without a day is refused');
  await assert.rejects(updateCoworkSchedule(kept, scope, ID(1), {}, { now: NOW }), ZodError, 'nothing to change');
  await assert.rejects(updateCoworkSchedule(kept, scope, ID(1), { owner: OTHER }, { now: NOW }), ZodError);
});

test('a task of someone else, or one that does not exist, is not found', async () => {
  const client = fakeClient([task(1, { user_id: OTHER })]);
  const notFound = (error: unknown) => error instanceof CoworkScheduleError && error.code === 'NOT_FOUND';
  await assert.rejects(updateCoworkSchedule(client, scope, ID(1), { enabled: false }), notFound);
  await assert.rejects(deleteCoworkSchedule(client, scope, ID(1)), notFound);
  await assert.rejects(runCoworkScheduleNow(client, scope, ID(1), { access: allowed }), notFound);
  assert.equal(client.rows.length, 1);
  const own = fakeClient([task(1)]);
  await deleteCoworkSchedule(own, scope, ID(1));
  assert.equal(own.rows.length, 0);
});

test('a task that is due starts a conversation in approval mode and moves to its next firing', async () => {
  const client = fakeClient([task(1), task(2, { next_run_at: '2026-10-26T15:00:00+00:00' }), task(3, { status: 'paused', next_run_at: null })]);
  const pass = await processCoworkSchedules({ client, now: NOW, access: allowed });
  assert.deepEqual(pass, { admitted: 1, skipped: 0, failed: 0, paused: 0 });
  assert.equal(client.admitted.length, 1);
  const call = client.admitted[0];
  assert.equal(call.p_mode, 'approval', 'nobody is watching: nothing is sent without approval');
  assert.equal(call.p_user_id, USER);
  assert.equal(call.p_organization_id, ORG);
  assert.ok(String(call.p_message).startsWith(`${COWORK_SCHEDULE_MARK} · Tarea 1\n`));
  assert.ok(String(call.p_message).includes('Dime quién respondió esta semana'));
  const [first, second, third] = client.rows;
  assert.equal(first.next_run_at, '2026-10-27T12:00:00.000Z');
  assert.equal(first.last_status, 'admitted');
  assert.equal(first.last_run_id, 'run-1');
  assert.equal(first.run_count, 1);
  assert.equal(second.next_run_at, '2026-10-26T15:00:00+00:00', 'not due yet: untouched');
  assert.equal(third.status, 'paused');
});

test('a firing is one conversation however many workers look at it, and the task moves only once', async () => {
  const requestIds: string[] = [];
  // The other worker gets there first: it moves the task between this worker\'s read and its update.
  const client = fakeClient([task(1)], { admit: args => { requestIds.push(String(args.p_request_id)); client.rows[0].next_run_at = '2026-10-27T12:00:00.000Z'; } });
  const pass = await processCoworkSchedules({ client, now: NOW, access: allowed });
  assert.equal(pass.admitted, 0, 'this worker lost the race and does not count it');
  assert.equal(client.rows[0].run_count, 0);
  const retry = fakeClient([task(1)], { admit: args => { requestIds.push(String(args.p_request_id)); } });
  resetCoworkSchedulePassForTests();
  await processCoworkSchedules({ client: retry, now: new Date(NOW.getTime() + 20_000), access: allowed });
  assert.equal(requestIds.length, 2);
  assert.equal(requestIds[0], requestIds[1], 'same task, same moment: same request id, so the database returns the same conversation');
});

test('a task that was due many times over fires once, and a firing missed for hours is skipped', async () => {
  const client = fakeClient([
    task(1, { next_run_at: '2026-10-22T12:00:00+00:00' }), // four days late
    task(2, { next_run_at: '2026-10-26T07:00:00+00:00' }), // five hours late: still inside the grace period
    task(3, { next_run_at: '2026-10-26T05:59:00+00:00' }), // six hours and a minute late
  ]);
  const pass = await processCoworkSchedules({ client, now: NOW, access: allowed });
  assert.deepEqual(pass, { admitted: 1, skipped: 2, failed: 0, paused: 0 });
  assert.equal(client.admitted.length, 1);
  assert.ok(String(client.admitted[0].p_message).includes('Tarea 2'));
  assert.deepEqual(client.rows.map(row => [row.last_status, row.next_run_at]), [
    ['skipped', '2026-10-27T12:00:00.000Z'], ['admitted', '2026-10-27T12:00:00.000Z'], ['skipped', '2026-10-27T12:00:00.000Z'],
  ]);
});

test('a firing that fails is tried again the next minute, and three in a row pause the task', async () => {
  const client = fakeClient([task(1)], { admit: () => ({ data: null, error: { message: 'boom' } }) });
  for (const minute of [0, 1, 2]) {
    const pass = await processCoworkSchedules({ client, now: new Date(NOW.getTime() + minute * 60_000), access: allowed });
    assert.equal(pass.failed, 1);
    assert.equal(pass.paused, minute === 2 ? 1 : 0);
  }
  assert.equal(client.rows[0].status, 'paused');
  assert.equal(client.rows[0].next_run_at, null);
  assert.equal(client.rows[0].last_status, 'failed');
  assert.equal(client.rows[0].consecutive_failures, 3);
  const none = await processCoworkSchedules({ client, now: new Date(NOW.getTime() + 3 * 60_000), access: allowed });
  assert.deepEqual(none, { admitted: 0, skipped: 0, failed: 0, paused: 0 }, 'a paused task is not looked at again');
});

test('a person who lost access to Cowork starts nothing', async () => {
  const client = fakeClient([task(1)]);
  const pass = await processCoworkSchedules({ client, now: NOW, access: revoked });
  assert.equal(pass.failed, 1);
  assert.equal(client.admitted.length, 0);
  assert.equal(client.rows[0].consecutive_failures, 1);
});

test('the pass looks at the queue every twenty seconds at most, and never throws', async () => {
  const client = fakeClient([task(1)]);
  await processCoworkSchedules({ client, now: NOW, access: allowed });
  const again = fakeClient([task(1)]);
  assert.deepEqual(await processCoworkSchedules({ client: again, now: new Date(NOW.getTime() + 5_000), access: allowed }), { admitted: 0, skipped: 0, failed: 0, paused: 0 });
  assert.equal(again.admitted.length, 0);
  const broken = fakeClient([task(1)], { error: { code: '57014', message: 'timeout' } });
  assert.deepEqual(await processCoworkSchedules({ client: broken, now: NOW, force: true, access: allowed }), { admitted: 0, skipped: 0, failed: 0, paused: 0 });
});

test('«Ejecutar ahora» starts the conversation without moving the schedule, and twice in a minute is one conversation', async () => {
  const client = fakeClient([task(1, { next_run_at: '2026-10-27T12:00:00+00:00' })]);
  const { runId } = await runCoworkScheduleNow(client, scope, ID(1), { now: NOW, access: allowed });
  assert.equal(runId, 'run-1');
  assert.equal(client.admitted[0].p_mode, 'approval');
  assert.equal(client.rows[0].next_run_at, '2026-10-27T12:00:00+00:00');
  assert.equal(client.rows[0].run_count, 1);
  await runCoworkScheduleNow(client, scope, ID(1), { now: new Date(NOW.getTime() + 10_000), access: allowed });
  assert.equal(client.admitted[1].p_request_id, client.admitted[0].p_request_id);
  await runCoworkScheduleNow(client, scope, ID(1), { now: new Date(NOW.getTime() + 90_000), access: allowed });
  assert.notEqual(client.admitted[2].p_request_id, client.admitted[0].p_request_id);
  await assert.rejects(runCoworkScheduleNow(client, scope, ID(1), { now: NOW, access: revoked }));
});
