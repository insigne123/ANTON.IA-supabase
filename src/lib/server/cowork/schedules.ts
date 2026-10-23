import { z } from 'zod';
import {
  COWORK_SCHEDULE_LIMITS, coworkScheduleFields, coworkScheduleInputSchema, coworkScheduleMessage, coworkScheduleOf, describeCoworkSchedule, nextCoworkScheduleRun,
  type CoworkSchedule, type CoworkScheduleFrequency,
} from '@/lib/cowork/schedules';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { requireCoworkWorkerAccess } from './access';
import { deterministicCoworkUuid } from './deterministic-id';

/**
 * Scheduled tasks of Cowork (lib/cowork/schedules.ts) on cowork_scheduled_tasks. The person reads their rows with their session; only
 * the server writes, with the service role, after checking the request and the limits. Every minute the worker (processCoworkQueue)
 * claims the tasks that are due and starts a conversation for each one, in approval mode, with the request as its first message.
 * Off unless COWORK_SCHEDULES_ENABLED=true: it needs the table and the effect of the migration 20261023120000.
 */
export function coworkSchedulesEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_SCHEDULES_ENABLED === 'true';
}

type Client = { from: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => any };
type Scope = { userId: string; organizationId: string };
type Row = Record<string, any>;

const TABLE = 'cowork_scheduled_tasks';
const FIELDS = 'id,title,prompt,frequency,time_of_day,weekday,month_day,time_zone,status,next_run_at,last_run_at,last_run_id,last_status,consecutive_failures,run_count,created_at';
const DUE_PER_PASS = 10;
const THROTTLE_MS = 20_000;
let lastPass = 0;

export class CoworkScheduleError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'LIMIT' | 'UNAVAILABLE', message: string) { super(message); }
}

export type CoworkScheduledTask = {
  id: string;
  title: string;
  prompt: string;
  frequency: CoworkScheduleFrequency;
  time: string;
  weekday: number | null;
  monthDay: number | null;
  timeZone: string;
  /** «Los lunes a las 09:00», as the list shows it. */
  description: string;
  status: 'proposed' | 'active' | 'paused';
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastStatus: 'admitted' | 'skipped' | 'failed' | null;
  runCount: number;
  createdAt: string;
};

const scheduleOfRow = (row: Row): CoworkSchedule => ({
  frequency: row.frequency, time: row.time_of_day, weekday: row.weekday ?? null, monthDay: row.month_day ?? null, timeZone: row.time_zone,
});

export function coworkTaskFromRow(row: Row): CoworkScheduledTask {
  return {
    id: String(row.id), title: String(row.title), prompt: String(row.prompt), frequency: row.frequency, time: row.time_of_day,
    weekday: row.weekday ?? null, monthDay: row.month_day ?? null, timeZone: row.time_zone, description: describeCoworkSchedule(scheduleOfRow(row)),
    status: row.status, nextRunAt: row.next_run_at ?? null, lastRunAt: row.last_run_at ?? null, lastRunId: row.last_run_id ?? null,
    lastStatus: row.last_status ?? null, runCount: Number(row.run_count) || 0, createdAt: String(row.created_at),
  };
}

/** The table is not there yet (PostgREST «could not find the table» or Postgres «undefined table»). */
export function isMissingSchedulesTable(error: unknown) {
  const { code, message } = (error || {}) as { code?: string; message?: string };
  return code === 'PGRST205' || code === '42P01' || /cowork_scheduled_tasks/.test(String(message || '')) && /(does not exist|could not find)/i.test(String(message || ''));
}

const isLimitError = (error: unknown) => (error as { code?: string } | null)?.code === '23514' && /Too many/.test(String((error as { message?: string }).message || ''));

const LIMIT_MESSAGE = `Ya tienes ${COWORK_SCHEDULE_LIMITS.active} tareas programadas activas. Pausa o elimina una para activar otra.`;

/** The person's tasks, oldest first. The ones Cowork proposed and nobody approved are not listed. */
export async function listCoworkSchedules(client: Pick<Client, 'from'>, scope: Scope): Promise<{ available: boolean; tasks: CoworkScheduledTask[] }> {
  const { data, error } = await client.from(TABLE).select(FIELDS)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).neq('status', 'proposed')
    .order('created_at', { ascending: true }).limit(50);
  if (error) {
    if (isMissingSchedulesTable(error)) return { available: false, tasks: [] };
    throw error;
  }
  return { available: true, tasks: ((data || []) as Row[]).map(coworkTaskFromRow) };
}

async function activeCount(client: Pick<Client, 'from'>, scope: Scope, excluding?: string) {
  let query = client.from(TABLE).select('id', { count: 'exact', head: true })
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).eq('status', 'active');
  if (excluding) query = query.neq('id', excluding);
  const { count, error } = await query;
  if (error) {
    if (isMissingSchedulesTable(error)) throw new CoworkScheduleError('UNAVAILABLE', 'Las tareas programadas todavía no están disponibles.');
    throw error;
  }
  return count || 0;
}

/**
 * Creates a task. `input` is checked here, whoever it comes from (the person's form or the proposal Cowork made from a chat). Active tasks
 * know when they fire next; a proposed one (status) waits for approval and has no date yet.
 */
export async function createCoworkSchedule(
  client: Pick<Client, 'from'>, scope: Scope, input: unknown,
  options: { now?: Date; status?: 'active' | 'proposed'; createdFromRunId?: string | null } = {},
): Promise<CoworkScheduledTask> {
  const parsed = coworkScheduleInputSchema.parse(input);
  const schedule = coworkScheduleOf(parsed);
  const status = options.status ?? 'active';
  if (status === 'active' && await activeCount(client, scope) >= COWORK_SCHEDULE_LIMITS.active) throw new CoworkScheduleError('LIMIT', LIMIT_MESSAGE);
  const { data, error } = await client.from(TABLE).insert({
    user_id: scope.userId, organization_id: scope.organizationId, title: parsed.title, prompt: parsed.prompt,
    frequency: schedule.frequency, time_of_day: schedule.time, weekday: schedule.weekday, month_day: schedule.monthDay, time_zone: schedule.timeZone,
    status, next_run_at: status === 'active' ? nextCoworkScheduleRun(schedule, options.now ?? new Date()).toISOString() : null,
    created_from_run_id: options.createdFromRunId ?? null,
  }).select(FIELDS).single();
  if (error) {
    if (isLimitError(error)) throw new CoworkScheduleError('LIMIT', /active/.test(String(error.message)) ? LIMIT_MESSAGE : 'Llegaste al máximo de tareas programadas. Elimina alguna para crear otra.');
    if (isMissingSchedulesTable(error)) throw new CoworkScheduleError('UNAVAILABLE', 'Las tareas programadas todavía no están disponibles.');
    throw error;
  }
  return coworkTaskFromRow(data as Row);
}

export const coworkSchedulePatchSchema = z.object({
  title: coworkScheduleFields.title.optional(),
  prompt: coworkScheduleFields.prompt.optional(),
  frequency: coworkScheduleFields.frequency.optional(),
  time: coworkScheduleFields.time.optional(),
  weekday: coworkScheduleFields.weekday,
  monthDay: coworkScheduleFields.monthDay,
  timeZone: coworkScheduleFields.timeZone,
  /** false pauses the task; true turns it on again. */
  enabled: z.boolean().optional(),
}).strict().refine(value => Object.values(value).some(item => item !== undefined), { message: 'Nada que cambiar' });

async function ownRow(client: Pick<Client, 'from'>, scope: Scope, id: string): Promise<Row> {
  z.string().uuid().parse(id);
  const { data, error } = await client.from(TABLE).select(FIELDS)
    .eq('id', id).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).neq('status', 'proposed').maybeSingle();
  if (error) throw error;
  if (!data) throw new CoworkScheduleError('NOT_FOUND', 'Esa tarea programada no existe.');
  return data as Row;
}

/** Pauses, resumes, renames or re-times a task. A change of cadence moves the next firing; resuming starts the count of failures again. */
export async function updateCoworkSchedule(client: Pick<Client, 'from'>, scope: Scope, id: string, input: unknown, options: { now?: Date } = {}): Promise<CoworkScheduledTask> {
  const patch = coworkSchedulePatchSchema.parse(input);
  const current = await ownRow(client, scope, id);
  const base = { title: current.title, prompt: current.prompt, frequency: current.frequency, time: current.time_of_day, weekday: current.weekday ?? null, monthDay: current.month_day ?? null, timeZone: current.time_zone };
  const { enabled, ...changes } = patch;
  const merged: Record<string, unknown> = { ...base, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) };
  // Another frequency drops the day of the week or of the month that no longer belongs, unless the change brings its own.
  if (changes.frequency !== undefined && changes.frequency !== base.frequency) {
    if (changes.weekday === undefined) merged.weekday = null;
    if (changes.monthDay === undefined) merged.monthDay = null;
  }
  const parsed = coworkScheduleInputSchema.parse(merged);
  const schedule = coworkScheduleOf(parsed);
  const status: 'active' | 'paused' = enabled === undefined ? (current.status === 'active' ? 'active' : 'paused') : enabled ? 'active' : 'paused';
  const cadenceChanged = schedule.frequency !== current.frequency || schedule.time !== current.time_of_day || schedule.weekday !== (current.weekday ?? null)
    || schedule.monthDay !== (current.month_day ?? null) || schedule.timeZone !== current.time_zone;
  if (status === 'active' && current.status !== 'active' && await activeCount(client, scope, id) >= COWORK_SCHEDULE_LIMITS.active) throw new CoworkScheduleError('LIMIT', LIMIT_MESSAGE);
  const update: Row = {
    title: parsed.title, prompt: parsed.prompt, frequency: schedule.frequency, time_of_day: schedule.time, weekday: schedule.weekday,
    month_day: schedule.monthDay, time_zone: schedule.timeZone, status,
    next_run_at: status !== 'active' ? null : current.status === 'active' && !cadenceChanged ? current.next_run_at : nextCoworkScheduleRun(schedule, options.now ?? new Date()).toISOString(),
    ...(status === 'active' && current.status !== 'active' ? { consecutive_failures: 0 } : {}),
  };
  const { data, error } = await client.from(TABLE).update(update)
    .eq('id', id).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).select(FIELDS).maybeSingle();
  if (error) {
    if (isLimitError(error)) throw new CoworkScheduleError('LIMIT', LIMIT_MESSAGE);
    throw error;
  }
  if (!data) throw new CoworkScheduleError('NOT_FOUND', 'Esa tarea programada no existe.');
  return coworkTaskFromRow(data as Row);
}

export async function deleteCoworkSchedule(client: Pick<Client, 'from'>, scope: Scope, id: string): Promise<void> {
  z.string().uuid().parse(id);
  const { data, error } = await client.from(TABLE).delete()
    .eq('id', id).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).select('id');
  if (error) throw error;
  if (!Array.isArray(data) || !data.length) throw new CoworkScheduleError('NOT_FOUND', 'Esa tarea programada no existe.');
}

type Access = (client: any, scope: Scope) => Promise<void>;

/** The conversation a firing starts: always in approval mode, so nothing is sent or spent without the person. Idempotent per request id. */
async function admit(client: Client, scope: Scope, requestId: string, message: string): Promise<string> {
  const { data, error } = await client.rpc('cowork_admit_run', {
    p_user_id: scope.userId, p_organization_id: scope.organizationId, p_request_id: requestId, p_message: message, p_mode: 'approval',
  });
  if (error || typeof data !== 'string') throw new Error('No se pudo iniciar la tarea programada.');
  return data;
}

/** «Ejecutar ahora»: starts the conversation of a task without moving its schedule. Twice in the same minute is the same conversation. */
export async function runCoworkScheduleNow(
  client: Client, scope: Scope, id: string, options: { now?: Date; access?: Access } = {},
): Promise<{ runId: string }> {
  const now = options.now ?? new Date();
  const row = await ownRow(client, scope, id);
  await (options.access ?? requireCoworkWorkerAccess)(client, scope);
  const requestId = deterministicCoworkUuid(`cowork:schedule-now:${id}:${Math.floor(now.getTime() / 60_000)}`);
  const runId = await admit(client, scope, requestId, coworkScheduleMessage({ title: row.title, prompt: row.prompt }, now, row.time_zone));
  const { error } = await client.from(TABLE).update({ last_run_at: now.toISOString(), last_run_id: runId, last_status: 'admitted', run_count: (Number(row.run_count) || 0) + 1 })
    .eq('id', id).eq('user_id', scope.userId).eq('organization_id', scope.organizationId);
  // The conversation exists either way; a counter that did not move is not worth failing the click.
  void error;
  return { runId };
}

export type CoworkSchedulePass = { admitted: number; skipped: number; failed: number; paused: number };

/**
 * One pass of the worker: for every active task whose time has come, starts its conversation and moves the task to its next firing.
 * The request id of a firing comes from the task and the moment it was due, so a second worker (or a retry) that starts the same
 * firing gets the same conversation, and the task only moves if nobody moved it first. A firing later than the grace period was
 * missed (the worker was down): it is skipped, never run late. Three failures in a row pause the task. Best effort; never throws.
 */
export async function processCoworkSchedules(options: { client?: Client; now?: Date; force?: boolean; access?: Access } = {}): Promise<CoworkSchedulePass> {
  const result: CoworkSchedulePass = { admitted: 0, skipped: 0, failed: 0, paused: 0 };
  const now = options.now ?? new Date();
  if (!options.force && now.getTime() - lastPass < THROTTLE_MS) return result;
  lastPass = now.getTime();
  try {
    const client = options.client ?? (getSupabaseAdminClient() as unknown as Client);
    const access = options.access ?? requireCoworkWorkerAccess;
    const due = await client.from(TABLE).select(`${FIELDS},user_id,organization_id`)
      .eq('status', 'active').lte('next_run_at', now.toISOString()).order('next_run_at', { ascending: true }).limit(DUE_PER_PASS);
    if (due.error || !Array.isArray(due.data)) return result;
    for (const row of due.data as Row[]) {
      const scope: Scope = { userId: String(row.user_id), organizationId: String(row.organization_id) };
      const dueAt = Date.parse(String(row.next_run_at));
      if (!Number.isFinite(dueAt)) continue;
      const schedule = scheduleOfRow(row);
      // The next firing after now, never in the past: a task that was due many times over fires once.
      const next = nextCoworkScheduleRun(schedule, new Date(Math.max(now.getTime(), dueAt)));
      const move = async (patch: Row) => {
        const moved = await client.from(TABLE).update(patch).eq('id', row.id).eq('status', 'active').eq('next_run_at', row.next_run_at).select('id');
        return !moved.error && Array.isArray(moved.data) && moved.data.length === 1;
      };
      try {
        if (now.getTime() - dueAt > COWORK_SCHEDULE_LIMITS.graceMs) {
          if (await move({ next_run_at: next.toISOString(), last_status: 'skipped' })) result.skipped++;
          continue;
        }
        await access(client, scope);
        const runId = await admit(client, scope, deterministicCoworkUuid(`cowork:schedule:${row.id}:${dueAt}`), coworkScheduleMessage({ title: row.title, prompt: row.prompt }, new Date(dueAt), row.time_zone));
        if (await move({ next_run_at: next.toISOString(), last_run_at: now.toISOString(), last_run_id: runId, last_status: 'admitted', consecutive_failures: 0, run_count: (Number(row.run_count) || 0) + 1 })) result.admitted++;
      } catch {
        const failures = (Number(row.consecutive_failures) || 0) + 1;
        const pause = failures >= COWORK_SCHEDULE_LIMITS.failuresToPause;
        // A failed firing stays due and is tried again next minute, until the grace period passes or three failures pause the task.
        if (await move(pause ? { status: 'paused', next_run_at: null, last_status: 'failed', consecutive_failures: failures } : { last_status: 'failed', consecutive_failures: failures }).catch(() => false)) {
          result.failed++;
          if (pause) result.paused++;
        }
      }
    }
  } catch {
    // The next minute tries again.
  }
  return result;
}

/** Test hook: the throttle of the pass is per process. */
export function resetCoworkSchedulePassForTests() { lastPass = 0; }
