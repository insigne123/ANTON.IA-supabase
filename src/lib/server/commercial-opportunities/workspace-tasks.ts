import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { AuthError } from '@/lib/server/auth-utils';
import { isOpportunityAdmin, type WorkScope } from '@/lib/commercial-opportunities/workspace';
import { chileDay, daysBetween, taskActivityLine, type MyTask, type newTaskSchema, type OpportunityTask, type TaskStatus } from '@/lib/commercial-opportunities/work-tasks';
import { assertOpportunityRead, readableOpportunityIds } from './workspace-access';
import { addOpportunityActivity, opportunityDb } from './workspace-store';
import { notifyPeople } from './workspace-decisions';

type Row = Record<string, any>;
type NewTask = z.infer<typeof newTaskSchema>;
/** Who got tasks they did not give themselves, for the email after the answer (workspace-decision-notice.ts). */
export type TaskNotice = { user: string; titles: string[]; dueAt: string | null };
const COLUMNS = 'id,title,owner_id,due_at,status,evidence,created_by,updated_at';

async function assertOwners(client: SupabaseClient, scope: WorkScope, id: string, owners: Array<string | null | undefined>) {
  const wanted = [...new Set(owners.filter((owner): owner is string => Boolean(owner)))];
  if (!wanted.length) return;
  const rows = (opportunityDb(await client.from('opportunity_participants').select('user_id').eq('organization_id', scope.organizationId).eq('opportunity_id', id)
    .in('user_id', wanted)) || []) as Row[];
  if (new Set(rows.map(row => String(row.user_id))).size < wanted.length) throw new AuthError('El responsable debe ser participante de esta oportunidad.', 400);
}
async function readTask(client: SupabaseClient, scope: WorkScope, id: string, taskId: string) {
  return opportunityDb(await client.from('opportunity_tasks').select(COLUMNS).eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', taskId).maybeSingle()) as OpportunityTask | null;
}
/**
 * Tells whoever got tasks on «Novedades»: «2 tareas para ti: <oportunidad>», once per person and event, never the person who gave them.
 * Returns the ones told, for the email.
 */
async function tellOwners(client: SupabaseClient, scope: WorkScope, id: string, tasks: Array<{ owner_id: string | null; title: string; due_at: string | null }>, key: string) {
  const owners = new Map<string, TaskNotice>();
  for (const task of tasks) {
    if (!task.owner_id || task.owner_id === scope.userId) continue;
    const notice = owners.get(task.owner_id) ?? { user: task.owner_id, titles: [], dueAt: null };
    notice.titles.push(task.title);
    if (task.due_at && (!notice.dueAt || Date.parse(task.due_at) < Date.parse(notice.dueAt))) notice.dueAt = task.due_at;
    owners.set(task.owner_id, notice);
  }
  if (!owners.size) return [];
  const item = opportunityDb(await client.from('commercial_opportunities').select('title').eq('organization_id', scope.organizationId).eq('id', id).maybeSingle()) as Row | null;
  const title = String(item?.title || 'Oportunidad').replace(/\s+/g, ' ').trim().slice(0, 300);
  for (const notice of owners.values())
    await notifyPeople(client, scope, id, [notice.user], `${notice.titles.length === 1 ? 'Tarea para ti' : `${notice.titles.length} tareas para ti`}: ${title}`, `${key}:${notice.user}`);
  return [...owners.values()];
}

/**
 * One task, new or edited (OPP-27). Its owner must be in the team; whoever gets it hears about it, and the activity says what changed.
 * An edit keeps the stage of the task unless it says another.
 */
export async function saveOpportunityTask(client: SupabaseClient, scope: WorkScope, id: string, input: NewTask & { id?: string; status?: TaskStatus }) {
  await assertOpportunityRead(client, scope, id);
  await assertOwners(client, scope, id, [input.ownerId]);
  const values = { title: input.title, owner_id: input.ownerId, due_at: input.dueAt, evidence: input.evidence, updated_at: new Date().toISOString() };
  if (input.id) {
    const before = await readTask(client, scope, id, input.id);
    if (!before) throw new AuthError('Esa tarea ya no existe. Actualiza la oportunidad.', 404);
    const status = input.status ?? before.status;
    opportunityDb(await client.from('opportunity_tasks').update({ ...values, status }).eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', input.id));
    await addOpportunityActivity(client, scope, id, 'task', taskActivityLine(status !== before.status ? status : 'edited', input.title), { taskId: input.id });
    const told = input.ownerId && input.ownerId !== before.owner_id ? await tellOwners(client, scope, id, [values], `task:${input.id}`) : [];
    return { id: input.id, status, moved: status !== before.status, told };
  }
  const status = input.status ?? 'pending';
  const created = opportunityDb(await client.from('opportunity_tasks').insert({ ...values, status, organization_id: scope.organizationId, opportunity_id: id, created_by: scope.userId })
    .select('id').single()) as { id: string };
  await addOpportunityActivity(client, scope, id, 'task', taskActivityLine('created', input.title), { taskId: created.id });
  const told = await tellOwners(client, scope, id, [values], `task:${created.id}`);
  return { id: created.id, status, moved: status !== 'pending', told };
}

/** The plan of the report turned into tasks at once (OPP-21): one line in the activity, and each owner told once of all theirs. */
export async function createOpportunityTasks(client: SupabaseClient, scope: WorkScope, id: string, tasks: NewTask[]) {
  await assertOpportunityRead(client, scope, id);
  await assertOwners(client, scope, id, tasks.map(task => task.ownerId));
  const now = new Date().toISOString();
  const rows = (opportunityDb(await client.from('opportunity_tasks').insert(tasks.map(task => ({ organization_id: scope.organizationId, opportunity_id: id, title: task.title,
    owner_id: task.ownerId, due_at: task.dueAt, status: 'pending', evidence: task.evidence, created_by: scope.userId, updated_at: now }))).select('id,title,owner_id,due_at')) || []) as Row[];
  await addOpportunityActivity(client, scope, id, 'task', rows.length === 1 ? taskActivityLine('created', String(rows[0].title)) : `Plan convertido en ${rows.length} tareas.`, { count: rows.length });
  const told = await tellOwners(client, scope, id, rows.map(row => ({ owner_id: row.owner_id ?? null, title: String(row.title), due_at: row.due_at ?? null })), `tasks:${randomUUID()}`);
  return { created: rows.length, told };
}

/** «Hecha», «En curso», «Bloqueada» or pending again, from the list: only the stage changes, whatever else changed meanwhile. */
export async function setOpportunityTaskStatus(client: SupabaseClient, scope: WorkScope, id: string, input: { id: string; status: TaskStatus }) {
  await assertOpportunityRead(client, scope, id);
  const before = await readTask(client, scope, id, input.id);
  if (!before) throw new AuthError('Esa tarea ya no existe. Actualiza la oportunidad.', 404);
  if (before.status === input.status) return { status: input.status, moved: false };
  opportunityDb(await client.from('opportunity_tasks').update({ status: input.status, updated_at: new Date().toISOString() })
    .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', input.id));
  await addOpportunityActivity(client, scope, id, 'task', taskActivityLine(input.status, before.title), { taskId: input.id });
  return { status: input.status, moved: true };
}

/** Deleting a task is for whoever created it, whoever is in charge of the opportunity or an administrator; whoever only has it marks it done. */
export async function deleteOpportunityTask(client: SupabaseClient, scope: WorkScope, id: string, taskId: string) {
  await assertOpportunityRead(client, scope, id);
  const task = await readTask(client, scope, id, taskId);
  if (!task) return { deleted: false };
  if (!isOpportunityAdmin(scope.role) && task.created_by !== scope.userId) {
    const work = opportunityDb(await client.from('opportunity_work').select('responsible_id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).maybeSingle()) as Row | null;
    if (work?.responsible_id !== scope.userId) throw new AuthError('Puede eliminarla quien la creó, quien está a cargo o un administrador. Si ya no hace falta, márcala como hecha.', 403);
  }
  opportunityDb(await client.from('opportunity_tasks').delete().eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', taskId));
  await addOpportunityActivity(client, scope, id, 'task', taskActivityLine('deleted', task.title), { taskId });
  return { deleted: true };
}

/** The tasks of this person still to do, in the opportunities they can read and that are in play (neither lost nor put aside). */
async function openTasks(client: SupabaseClient, scope: WorkScope, columns: string, limit: number) {
  const [ids, tasks] = await Promise.all([
    readableOpportunityIds(client, scope),
    client.from('opportunity_tasks').select(`${columns},opportunity_id`).eq('organization_id', scope.organizationId).eq('owner_id', scope.userId).neq('status', 'done')
      .order('due_at', { ascending: true }).limit(limit).then(result => (opportunityDb(result) || []) as Row[]),
  ]);
  const readable = ids ? new Set(ids) : null;
  const rows = tasks.filter(row => !readable || readable.has(String(row.opportunity_id)));
  if (!rows.length) return { rows, opportunities: [] as string[] };
  const opportunities = [...new Set(rows.map(row => String(row.opportunity_id)))];
  const work = (opportunityDb(await client.from('opportunity_work').select('opportunity_id,state').eq('organization_id', scope.organizationId).in('opportunity_id', opportunities)) || []) as Row[];
  const closed = new Set(work.filter(row => row.state === 'lost' || row.state === 'archived').map(row => String(row.opportunity_id)));
  return { rows: rows.filter(row => !closed.has(String(row.opportunity_id))), opportunities: opportunities.filter(item => !closed.has(item)) };
}
/** «Mis tareas» (OPP-27), with the opportunity each one belongs to. */
export async function readMyOpportunityTasks(client: SupabaseClient, scope: WorkScope, limit = 200): Promise<MyTask[]> {
  const { rows, opportunities } = await openTasks(client, scope, COLUMNS, limit);
  if (!rows.length) return [];
  const items = (opportunityDb(await client.from('commercial_opportunities').select('id,title,kind,deadline_at').eq('organization_id', scope.organizationId).in('id', opportunities)) || []) as Row[];
  const byId = new Map(items.map(item => [String(item.id), { id: String(item.id), title: String(item.title || 'Oportunidad'), kind: String(item.kind || ''), deadline_at: item.deadline_at ?? null }]));
  return rows.flatMap(row => {
    const opportunity = byId.get(String(row.opportunity_id));
    return opportunity ? [{ id: String(row.id), title: String(row.title), owner_id: row.owner_id ?? null, due_at: row.due_at ?? null, status: row.status as TaskStatus,
      evidence: String(row.evidence || ''), created_by: row.created_by ?? null, updated_at: row.updated_at ?? null, opportunity }] : [];
  });
}
/** How many of «Mis tareas» there are and how many are late, for the view's name in the list («Mis tareas · 3»). */
export async function countMyOpportunityTasks(client: SupabaseClient, scope: WorkScope, now = new Date()) {
  const { rows } = await openTasks(client, scope, 'due_at', 500);
  const today = chileDay(now);
  return { open: rows.length, late: rows.filter(row => row.due_at && Number.isFinite(Date.parse(row.due_at)) && daysBetween(today, chileDay(row.due_at)) < 0).length };
}
