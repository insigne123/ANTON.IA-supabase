import { dayInZone, dayStartInZone, shiftDay } from '@/lib/admin/chile-time';
import { workReport, type WorkReport, type WorkReportInput } from '@/lib/admin/work';
import { OPPORTUNITY_MONTHLY_MICRO_USD } from '@/lib/commercial-opportunities/workspace';
import { loadAdminCreditOverview } from '@/lib/server/admin-credit-data';
import { readWaitingOnAdmins } from '@/lib/server/commercial-opportunities/workspace-waiting';
import { AdminDashboardAuthError } from './admin-dashboard-auth';

const ROWS = 10_000;
/** A read the report cannot do without; the optional ones (credits, Cowork before its tables) leave their part out instead. */
const rowsOf = (result: { data: unknown; error: unknown }) => {
  if (result.error) throw new AdminDashboardAuthError('No pudimos cargar el informe de Oportunidades y Cowork.', 503);
  return (result.data || []) as any[];
};
const optional = (result: { data: unknown; error: unknown }) => (result.error ? [] : (result.data || []) as any[]);

/**
 * «Oportunidades y Cowork» of one organization (lib/admin/work.ts): the people of the organization by name, the opportunities in play
 * and what was done on them in the period, the decisions waiting, Cowork's turns and calls with their cost, and the three budgets.
 */
export async function loadAdminWork(supabase: any, organization: { id: string; name: string }, period: { from: string; to: string }, now = new Date()): Promise<WorkReport & { period: { from: string; to: string } }> {
  const org = organization.id;
  const start = dayStartInZone(period.from).toISOString(), end = dayStartInZone(shiftDay(period.to, 1)).toISOString();
  const todayStart = dayStartInZone(dayInZone(now)).toISOString();
  const month = `${now.toISOString().slice(0, 7)}-01`;
  type Rows = any[];
  const [members, work, participants, activity, waiting, runs, calls, callsToday, budget, credits]: [Rows, Rows, Rows, Rows, number, Rows, Rows, Rows, any,
    Awaited<ReturnType<typeof loadAdminCreditOverview>> | null] = await Promise.all([
    supabase.from('organization_members').select('user_id').eq('organization_id', org).limit(1000).then(rowsOf),
    supabase.from('opportunity_work').select('opportunity_id,state,responsible_id').eq('organization_id', org).in('state', ['assigned', 'working', 'blocked']).limit(ROWS).then(rowsOf),
    supabase.from('opportunity_participants').select('opportunity_id,user_id').eq('organization_id', org).limit(ROWS).then(rowsOf),
    supabase.from('opportunity_activity').select('actor_id,kind,to:data->>to,created_at').eq('organization_id', org).gte('created_at', start).lt('created_at', end).limit(ROWS).then(rowsOf),
    readWaitingOnAdmins(supabase, org, now).then(items => items.length).catch(() => 0),
    supabase.from('cowork_runs').select('id,user_id,root_run_id,created_at').eq('organization_id', org).gte('created_at', start).lt('created_at', end).limit(ROWS).then(optional),
    supabase.from('cowork_model_calls').select('user_id,created_at,cost:usage->>costUsd').eq('organization_id', org).gte('created_at', start).lt('created_at', end).limit(ROWS * 2).then(optional),
    supabase.from('cowork_model_calls').select('user_id').eq('organization_id', org).gte('created_at', todayStart).limit(ROWS).then(optional),
    supabase.from('opportunity_budget_months').select('spent_micro_usd').eq('organization_id', org).eq('period', month).maybeSingle().then((result: any) => (result.error ? null : result.data)),
    loadAdminCreditOverview(supabase, org, organization.name).catch(() => null),
  ]);
  const ids = [...new Set(members.map(row => String(row.user_id)))];
  const [profiles, deadlines]: [Rows, Rows] = await Promise.all([
    ids.length ? supabase.from('profiles').select('id,full_name,email').in('id', ids).then(optional) : [],
    work.length ? supabase.from('commercial_opportunities').select('id,deadline_at').eq('organization_id', org).in('id', work.map(row => row.opportunity_id)).then(optional) : [],
  ]);
  // Whoever has no name yet is listed by their email, as in Oportunidades.
  const names = new Map<string, string>(profiles.map((row: any) => [String(row.id), String(row.full_name || '').trim() || String(row.email || '').trim() || 'Integrante']));
  const deadlineOf = new Map<string, string | null>(deadlines.map((row: any) => [String(row.id), row.deadline_at ? String(row.deadline_at) : null]));
  const input: WorkReportInput = {
    people: ids.map(id => ({ id, name: names.get(id) || 'Integrante' })), ...period, now,
    work: work.map(row => ({ opportunityId: String(row.opportunity_id), state: String(row.state), responsibleId: row.responsible_id ? String(row.responsible_id) : null, deadlineAt: deadlineOf.get(String(row.opportunity_id)) ?? null })),
    participants: participants.map(row => ({ opportunityId: String(row.opportunity_id), userId: String(row.user_id) })),
    activity: activity.map(row => ({ actorId: row.actor_id ? String(row.actor_id) : null, kind: String(row.kind), to: row.to ?? null, createdAt: String(row.created_at) })),
    waiting,
    runs: runs.map(row => ({ id: String(row.id), userId: String(row.user_id), rootRunId: row.root_run_id ? String(row.root_run_id) : null, createdAt: String(row.created_at) })),
    calls: calls.map(row => ({ userId: String(row.user_id), createdAt: String(row.created_at), costUsd: row.cost === null || row.cost === undefined || !Number.isFinite(Number(row.cost)) ? null : Number(row.cost) })),
    callsToday: callsToday.map(row => ({ userId: String(row.user_id) })),
    budget: { spent: Number(budget?.spent_micro_usd || 0) / 1e6, cap: OPPORTUNITY_MONTHLY_MICRO_USD / 1e6 },
    credits: credits ? { used: credits.users.reduce((sum, user) => sum + (user.userUsage ?? 0), 0), limit: credits.users.reduce((sum, user) => sum + (user.userLimit || 0), 0) } : null,
  };
  return { ...workReport(input), period };
}
