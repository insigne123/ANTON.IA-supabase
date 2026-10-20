import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveTargets, validTargets, type GoalCounts, type GoalProgress, type GoalTargets } from '@/lib/weekly-goals';

/** The reads and the save of «Metas semanales» (src/lib/weekly-goals.ts), with the service client and an explicit organization. */
type Client = SupabaseClient;
export type GoalScope = { organizationId: string; userId: string };
export type GoalRange = { from: string; to: string };
export type GoalSettings = { team: GoalTargets | null; people: Map<string, GoalTargets> };

export class WeeklyGoalsError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);
const ZERO: GoalCounts = { contacted: 0, found: 0 };

/** Every page of a query, up to 20 000 rows: a week of a large team fits. */
async function pages(build: () => any) {
  const rows: any[] = [];
  for (let page = 0; page < 20; page++) {
    const result = await build().range(page * 1000, page * 1000 + 999);
    if (result.error) throw new WeeklyGoalsError('No pudimos leer el avance de las metas.', 503);
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
  return rows;
}

const inRange = (at: string | null | undefined, range: GoalRange) => {
  const time = Date.parse(at || '');
  return Number.isFinite(time) && time >= Date.parse(range.from) && time < Date.parse(range.to);
};

/** The team's goal and each person's own, as the admins left them; none before the migration. */
export async function readGoalSettings(client: Client, organizationId: string): Promise<GoalSettings> {
  const result: any = await client.from('weekly_goals').select('user_id,contacted,found').eq('organization_id', organizationId).limit(1000);
  if (result.error) {
    if (MISSING.has(String(result.error.code))) return { team: null, people: new Map() };
    throw new WeeklyGoalsError('No pudimos leer las metas.', 503);
  }
  let team: GoalTargets | null = null;
  const people = new Map<string, GoalTargets>();
  for (const row of result.data || []) {
    const targets = validTargets({ contacted: row.contacted, found: row.found });
    if (!targets) continue;
    if (row.user_id) people.set(String(row.user_id), targets); else team = targets;
  }
  return { team, people };
}

/**
 * What each person did toward the goal in the range: new contacts with an email (saved in the range, one per address) and
 * people contacted (an email confirmed sent, or a LinkedIn message or a call marked done, one per person). Only one person
 * when `userId` is given.
 */
export async function readGoalCounts(client: Client, organizationId: string, range: GoalRange, userId?: string) {
  const scoped = (table: string, columns: string) => {
    const query = client.from(table).select(columns).eq('organization_id', organizationId);
    return userId ? query.eq('user_id', userId) : query;
  };
  const [saved, dispatches, touches] = await Promise.all([
    pages(() => scoped('enriched_leads', 'id,user_id,email').gte('created_at', range.from).lt('created_at', range.to).not('email', 'is', null).neq('email', '').order('id')),
    pages(() => scoped('outbound_dispatches', 'id,user_id,metadata,completed_at,reconciliation_details').eq('status', 'sent').eq('channel', 'email')
      .gte('completed_at', range.from).lt('completed_at', range.to).order('id')),
    // «Llamadas y LinkedIn» may not exist in an old database: the goal then counts the emails only.
    scoped('contact_touches', 'user_id,contacted_id').eq('state', 'done').in('channel', ['linkedin', 'call']).gte('done_at', range.from).lt('done_at', range.to).limit(5000),
  ]);
  const touchRows = ((touches as any).error ? [] : (touches as any).data || []) as Array<{ user_id: string; contacted_id: string }>;
  // A person written to by email and also called counts once: a touch is keyed by the address of its conversation.
  const ids = [...new Set(touchRows.map(row => String(row.contacted_id || '')).filter(Boolean))];
  const addresses = new Map<string, string>();
  for (let start = 0; start < ids.length; start += 200) {
    const result: any = await client.from('contacted_leads').select('id,email').eq('organization_id', organizationId).in('id', ids.slice(start, start + 200));
    if (result.error) throw new WeeklyGoalsError('No pudimos leer el avance de las metas.', 503);
    for (const row of result.data || []) if (row.email) addresses.set(String(row.id), String(row.email).trim().toLowerCase());
  }
  const found = new Map<string, Set<string>>(), contacted = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, user: string, key: string) => { if (!key) return; const set = map.get(user) || new Set<string>(); set.add(key); map.set(user, set); };
  for (const row of saved) add(found, String(row.user_id), String(row.email || '').trim().toLowerCase());
  for (const row of dispatches) {
    if (!inRange(row.reconciliation_details?.sentAt || row.completed_at, range)) continue;
    add(contacted, String(row.user_id), String(row.metadata?.recipient?.email || '').trim().toLowerCase() || `dispatch:${row.id}`);
  }
  for (const row of touchRows) add(contacted, String(row.user_id), addresses.get(String(row.contacted_id)) || `touch:${row.contacted_id}`);
  const counts = new Map<string, GoalCounts>();
  for (const user of new Set([...found.keys(), ...contacted.keys()])) counts.set(user, { contacted: contacted.get(user)?.size || 0, found: found.get(user)?.size || 0 });
  return counts;
}

/** Contacts with an email nobody wrote to yet, the same count as «Hoy»: what the goal's next step offers to write to. */
export async function readReadyToWrite(client: Client, scope: GoalScope) {
  const own = (table: string, columns: string) => client.from(table).select(columns).eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  const [enriched, sent]: any[] = await Promise.all([
    own('enriched_leads', 'email').not('email', 'is', null).neq('email', '').limit(1000),
    own('contacted_leads', 'email').not('sent_at', 'is', null).limit(5000),
  ]);
  if (enriched.error || sent.error) throw new WeeklyGoalsError('No pudimos leer tus contactos.', 503);
  const written = new Set((sent.data || []).map((row: any) => String(row.email || '').trim().toLowerCase()));
  return new Set((enriched.data || []).map((row: any) => String(row.email || '').trim().toLowerCase()).filter((email: string) => email && !written.has(email))).size;
}

/** One person's goal and how far they got in the range. */
export async function readPersonGoal(client: Client, scope: GoalScope, range: GoalRange): Promise<GoalProgress> {
  const [settings, counts] = await Promise.all([readGoalSettings(client, scope.organizationId), readGoalCounts(client, scope.organizationId, range, scope.userId)]);
  return { ...resolveTargets(settings.team, settings.people.get(scope.userId) || null), counts: counts.get(scope.userId) || ZERO };
}

/** Every member's goal and progress, for «Equipo»: asked by person once the members are known. */
export async function readTeamGoals(client: Client, organizationId: string, range: GoalRange) {
  const [settings, counts] = await Promise.all([readGoalSettings(client, organizationId), readGoalCounts(client, organizationId, range)]);
  return (userId: string): GoalProgress => ({ ...resolveTargets(settings.team, settings.people.get(userId) || null), counts: counts.get(userId) || ZERO });
}

/**
 * Replaces the goals of an organization: the team's, and the people whose goal differs. Only owners and admins, and only
 * for members of the organization. Whoever is left out goes back to the team's goal.
 */
export async function saveGoalSettings(client: Client, scope: GoalScope, input: { team: GoalTargets; people: Array<{ userId: string; targets: GoalTargets }> }) {
  const member: any = await client.from('organization_members').select('role').eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (member.error) throw new WeeklyGoalsError('No pudimos comprobar tu rol.', 503);
  if (!['owner', 'admin'].includes(String(member.data?.role))) throw new WeeklyGoalsError('Solo un administrador puede cambiar las metas.', 403);
  const people = [...new Map(input.people.map(person => [person.userId, person])).values()].slice(0, 200);
  if (people.length) {
    const members: any = await client.from('organization_members').select('user_id').eq('organization_id', scope.organizationId).in('user_id', people.map(person => person.userId));
    if (members.error || (members.data || []).length !== people.length) throw new WeeklyGoalsError('Elige personas de tu organización.', 400);
  }
  const stamp = { set_by: scope.userId, updated_at: new Date().toISOString() };
  const team = await client.from('weekly_goals').upsert({ organization_id: scope.organizationId, user_id: null, ...input.team, ...stamp }, { onConflict: 'organization_id,user_id' });
  if (team.error) throw new WeeklyGoalsError(MISSING.has(String(team.error.code)) ? 'Las metas aún no están disponibles.' : 'No pudimos guardar las metas.', 503);
  let stale = client.from('weekly_goals').delete().eq('organization_id', scope.organizationId).not('user_id', 'is', null);
  if (people.length) stale = stale.not('user_id', 'in', `(${people.map(person => person.userId).join(',')})`);
  const removed = await stale;
  if (removed.error) throw new WeeklyGoalsError('No pudimos guardar las metas.', 503);
  if (people.length) {
    const saved = await client.from('weekly_goals').upsert(people.map(person => ({ organization_id: scope.organizationId, user_id: person.userId, ...person.targets, ...stamp })), { onConflict: 'organization_id,user_id' });
    if (saved.error) throw new WeeklyGoalsError('No pudimos guardar las metas.', 503);
  }
  return { team: input.team, people: people.map(person => ({ userId: person.userId, targets: person.targets })) };
}
