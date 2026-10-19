import type { SupabaseClient } from '@supabase/supabase-js';
import { replyNeedsAnswer } from '@/lib/home/today';
import { preferredFullName } from '@/lib/lead-name';
import {
  OPPORTUNITY_KINDS, reportEmail, reportWeek, type ClosingOpportunity, type Commitment, type OpportunitiesSection, type PendingReply,
  type PersonalSection, type ReportRole, type ReportWeek, type TeamMember, type TeamSection, type WeeklyReport,
} from '@/lib/weekly-report';

/** The reads of «Informe semanal» (src/lib/weekly-report.ts), with the service client and explicit organization and person. */
type Client = SupabaseClient;
export type ReportScope = { organizationId: string; userId: string };

export class WeeklyReportError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const HUMAN = new Set(['positive', 'meeting_request', 'neutral', 'negative', 'unsubscribe']);
const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);
const CLOSED_WORK = new Set(['won', 'lost', 'archived', 'submitted']);

/** Every page of a query, up to 20 000 rows: a week of a large team fits; beyond that the report says it is partial. */
async function all(build: () => any) {
  const rows: any[] = [];
  for (let page = 0; page < 20; page++) {
    const result = await build().range(page * 1000, page * 1000 + 999);
    if (result.error) throw new WeeklyReportError('No pudimos leer la actividad de la semana.', 503);
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
  return rows;
}

const inRange = (at: string | null | undefined, from: string, to: string) => {
  const time = Date.parse(at || '');
  return Number.isFinite(time) && time >= Date.parse(from) && time < Date.parse(to);
};

/** Sent emails and the people they went to, this week and the one before, from the dispatches confirmed by the provider. */
function countDispatches(rows: any[], week: ReportWeek) {
  const out = { sent: { now: 0, before: 0 }, contacted: { now: 0, before: 0 } };
  const people = { now: new Set<string>(), before: new Set<string>() };
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.channel !== 'email' || seen.has(row.id)) continue;
    seen.add(row.id);
    const at = row.reconciliation_details?.sentAt || row.completed_at;
    const period = inRange(at, week.from, week.to) ? 'now' : inRange(at, week.previousFrom, week.previousTo) ? 'before' : null;
    if (!period) continue;
    out.sent[period]++;
    const email = String(row.metadata?.recipient?.email || '').trim().toLowerCase();
    if (email) people[period].add(email);
  }
  out.contacted = { now: people.now.size, before: people.before.size };
  return out;
}

/** People who replied (a person, not an auto-reply or a bounce), this week and the one before, and who asked to meet. */
function countReplies(rows: any[], week: ReportWeek) {
  const now = new Set<string>(), before = new Set<string>(), meetings = new Set<string>();
  for (const row of rows) {
    if (!HUMAN.has(row.reply_intent)) continue;
    const key = String(row.email || row.id).trim().toLowerCase();
    if (inRange(row.replied_at, week.from, week.to)) { now.add(key); if (row.reply_intent === 'meeting_request') meetings.add(key); }
    else if (inRange(row.replied_at, week.previousFrom, week.previousTo)) before.add(key);
  }
  return { replies: { now: now.size, before: before.size }, meetings: meetings.size };
}

/** Who wrote and waits for an answer: the same rule as «Por responder» in Conversaciones, one row per person. */
function pendingReplies(rows: any[]): PendingReply[] {
  const byPerson = new Map<string, PendingReply>();
  for (const row of rows.filter(replyNeedsAnswer)) {
    const key = String(row.email || row.id).trim().toLowerCase();
    const known = byPerson.get(key);
    if (known) known.name = preferredFullName(known.name, row.name) || known.name;
    else byPerson.set(key, { id: String(row.id), name: String(row.name || row.email || 'Contacto').trim(), company: row.company || null, repliedAt: row.replied_at });
  }
  return [...byPerson.values()].sort((a, b) => a.repliedAt.localeCompare(b.repliedAt));
}

/** Open commitments due before the end of the coming week, overdue ones included. */
function openCommitments(rows: any[], now: Date): Commitment[] {
  const until = now.getTime() + 8 * 86_400_000;
  return rows.flatMap(row => {
    const commitment = row.data?.commitment;
    if (!commitment || typeof commitment !== 'object' || commitment.completedAt) return [];
    const due = Date.parse(String(commitment.dueAt || ''));
    if (!Number.isFinite(due) || due >= until) return [];
    return [{ id: String(row.id), name: String(row.name || 'Contacto').trim(), company: row.company || null, title: String(commitment.title || 'Compromiso').slice(0, 120), dueAt: new Date(due).toISOString() }];
  }).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export async function readPersonal(client: Client, scope: ReportScope, week: ReportWeek, now = new Date()): Promise<PersonalSection> {
  const own = (table: string, columns: string) => client.from(table).select(columns).eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  const [dispatches, replies, waiting, commitments, touches] = await Promise.all([
    all(() => own('outbound_dispatches', 'id,channel,metadata,completed_at,reconciliation_details').eq('status', 'sent').gte('completed_at', week.previousFrom).lt('completed_at', week.to).order('id')),
    all(() => own('contacted_leads', 'id,email,reply_intent,replied_at').gte('replied_at', week.previousFrom).lt('replied_at', week.to).order('id')),
    own('contacted_leads', 'id,email,name,company,reply_intent,replied_at,conversation_resolved_at,conversation_outbound_at').not('replied_at', 'is', null).order('replied_at', { ascending: false }).limit(200),
    own('contacted_leads', 'id,name,company,data').not('data->commitment', 'is', null).limit(200),
    // «Llamadas y LinkedIn» (contact_touches) may not exist yet: the report goes on without it.
    own('contact_touches', 'channel,done_at').eq('state', 'done').gte('done_at', week.from).lt('done_at', week.to).limit(2000),
  ]);
  for (const result of [waiting, commitments]) if ((result as any).error) throw new WeeklyReportError('No pudimos leer tus pendientes.', 503);
  const touchRows = (touches as any).error ? null : ((touches as any).data || []) as Array<{ channel: string }>;
  const sent = countDispatches(dispatches, week);
  const answered = countReplies(replies, week);
  return {
    ...sent, ...answered,
    pending: pendingReplies((waiting as any).data || []).slice(0, 10),
    commitments: openCommitments((commitments as any).data || [], now).slice(0, 10),
    touches: touchRows ? { calls: touchRows.filter(row => row.channel === 'call').length, linkedin: touchRows.filter(row => row.channel === 'linkedin').length } : null,
  };
}

/** Each member of the organization this week, the busiest first; for owners and admins. */
export async function readTeam(client: Client, organizationId: string, week: ReportWeek): Promise<TeamSection> {
  const members: any = await client.from('organization_members').select('user_id,role').eq('organization_id', organizationId);
  if (members.error) throw new WeeklyReportError('No pudimos leer el equipo.', 503);
  const ids = (members.data || []).map((row: any) => String(row.user_id));
  const org = (table: string, columns: string) => client.from(table).select(columns).eq('organization_id', organizationId);
  const since = new Date(Date.parse(week.to) - 30 * 86_400_000).toISOString();
  const [profiles, dispatches, replies, waiting] = await Promise.all([
    ids.length ? client.from('profiles').select('id,full_name,email').in('id', ids) : Promise.resolve({ data: [], error: null }),
    all(() => org('outbound_dispatches', 'id,user_id,channel,metadata,completed_at,reconciliation_details').eq('status', 'sent').gte('completed_at', week.previousFrom).lt('completed_at', week.to).order('id')),
    all(() => org('contacted_leads', 'id,user_id,email,reply_intent,replied_at').gte('replied_at', week.previousFrom).lt('replied_at', week.to).order('id')),
    all(() => org('contacted_leads', 'id,user_id,email,name,reply_intent,replied_at,conversation_resolved_at,conversation_outbound_at').gte('replied_at', since).order('id')),
  ]);
  if ((profiles as any).error) throw new WeeklyReportError('No pudimos leer el equipo.', 503);
  const names = new Map<string, string>(((profiles as any).data || []).map((row: any) => [String(row.id), String(row.full_name || String(row.email || '').split('@')[0] || 'Sin nombre').trim()]));
  const emails = new Map<string, string>(((profiles as any).data || []).filter((row: any) => row.email).map((row: any) => [String(row.id), String(row.email)]));
  const shared = (name: string) => ids.filter((id: string) => (names.get(id) || 'Sin nombre').toLocaleLowerCase('es') === name.toLocaleLowerCase('es')).length > 1;
  const of = (rows: any[], userId: string) => rows.filter(row => row.user_id === userId);
  const list: TeamMember[] = (members.data || []).map((member: any) => {
    const userId = String(member.user_id);
    const sent = countDispatches(of(dispatches, userId), week);
    const answered = countReplies(of(replies, userId), week);
    const name = names.get(userId) || 'Sin nombre';
    return { userId, name, detail: shared(name) ? emails.get(userId) || null : null, role: String(member.role || 'member'), sent: sent.sent.now, replies: answered.replies.now,
      meetings: answered.meetings, pending: pendingReplies(of(waiting, userId)).length };
  }).sort((a: TeamMember, b: TeamMember) => b.sent - a.sent || b.replies - a.replies || a.name.localeCompare(b.name, 'es'));
  const totalSent = countDispatches(dispatches, week);
  const totalReplies = countReplies(replies, week);
  return { members: list, totals: { sent: totalSent.sent, replies: totalReplies.replies, meetings: totalReplies.meetings } };
}

/** What Oportunidades found this week and what closes in the next seven days, with who has it. */
export async function readOpportunities(client: Client, organizationId: string, week: ReportWeek, now = new Date()): Promise<OpportunitiesSection> {
  const soon = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const [found, closing, decided] = await Promise.all([
    all(() => client.from('commercial_opportunities').select('id,kind,data').eq('organization_id', organizationId).gte('created_at', week.from).lt('created_at', week.to).order('id')),
    client.from('commercial_opportunities').select('id,kind,title,buyer_name,company_name,deadline_at,amount,currency,data').eq('organization_id', organizationId)
      .gte('deadline_at', now.toISOString()).lt('deadline_at', soon).order('deadline_at').limit(200),
    client.from('opportunity_work').select('state').eq('organization_id', organizationId).in('state', ['won', 'lost']).gte('updated_at', week.from).lt('updated_at', week.to).limit(1000),
  ]);
  if ((closing as any).error) throw new WeeklyReportError('No pudimos leer las oportunidades.', 503);
  const open = (((closing as any).data || []) as any[]).filter(row => row.data?.evaluation !== 'excluded');
  const work = open.length ? await client.from('opportunity_work').select('opportunity_id,state').eq('organization_id', organizationId).in('opportunity_id', open.map(row => row.id)) : { data: [], error: null };
  const stateOf = new Map<string, string>((((work as any).data || []) as any[]).map(row => [String(row.opportunity_id), String(row.state)]));
  const live: ClosingOpportunity[] = open.filter(row => !CLOSED_WORK.has(stateOf.get(row.id) || '')).map(row => ({
    id: String(row.id), kind: String(row.kind), title: String(row.title || 'Oportunidad'), buyer: row.buyer_name || row.company_name || null,
    deadlineAt: row.deadline_at, amount: row.amount === null || row.amount === undefined ? null : Number(row.amount), currency: row.currency || null,
    assigned: (stateOf.get(row.id) || 'unassigned') !== 'unassigned',
  }));
  const counts = new Map<string, number>();
  for (const row of found) if (row.data?.evaluation !== 'excluded') counts.set(row.kind, (counts.get(row.kind) || 0) + 1);
  const decidedRows = (((decided as any).error ? [] : (decided as any).data) || []) as Array<{ state: string }>;
  return {
    found: {
      total: [...counts.values()].reduce((sum, count) => sum + count, 0),
      recommended: found.filter(row => row.data?.evaluation === 'recommended').length,
      byKind: [...counts].map(([kind, count]) => ({ kind, label: OPPORTUNITY_KINDS[kind] || kind, count })).sort((a, b) => b.count - a.count),
    },
    closing: live.slice(0, 10), unassignedClosing: live.filter(item => !item.assigned).length,
    won: decidedRows.filter(row => row.state === 'won').length, lost: decidedRows.filter(row => row.state === 'lost').length,
  };
}

/** The «Gestores de oportunidades» of an organization; none before the migration. */
export async function readOpportunityManagers(client: Client, organizationId: string) {
  const result: any = await client.from('organization_report_roles').select('user_id').eq('organization_id', organizationId).eq('role', 'opportunities');
  if (result.error) {
    if (MISSING.has(String(result.error.code))) return [];
    throw new WeeklyReportError('No pudimos leer los gestores de oportunidades.', 503);
  }
  return (result.data || []).map((row: any) => String(row.user_id)) as string[];
}

/**
 * The roles of a person: everyone has «Tu semana»; owners and admins «Equipo»; «Oportunidades» goes to its managers, or
 * to the admins while there are none, and only to whoever may see Oportunidades.
 */
export async function reportRoles(client: Client, scope: ReportScope, canSeeOpportunities: () => Promise<boolean>) {
  // The three reads do not depend on each other: asked together they cost one round trip, not three. Membership is still
  // checked first, so a stranger hears «No perteneces» and not a failure of the managers.
  const [member, managers, mayOpportunities]: [any, { value: string[] } | { error: unknown }, boolean] = await Promise.all([
    client.from('organization_members').select('role').eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle(),
    readOpportunityManagers(client, scope.organizationId).then(value => ({ value }), error => ({ error })),
    canSeeOpportunities().catch(() => false),
  ]);
  if (member.error) throw new WeeklyReportError('No pudimos comprobar tu rol.', 503);
  if (!member.data) throw new WeeklyReportError('No perteneces a esta organización.', 403);
  if ('error' in managers) throw managers.error;
  const admin = ['owner', 'admin'].includes(String(member.data.role));
  const roles: ReportRole[] = ['personal'];
  if (admin) roles.push('team');
  if ((managers.value.includes(scope.userId) || (admin && !managers.value.length)) && mayOpportunities) roles.push('opportunities');
  return { roles, admin, managers: managers.value };
}

export async function buildWeeklyReport(client: Client, scope: ReportScope, options: { which: ReportWeek['which']; canSeeOpportunities: () => Promise<boolean>; now?: Date }) {
  const now = options.now ?? new Date();
  const week = reportWeek(now, options.which);
  const { roles, admin, managers } = await reportRoles(client, scope, options.canSeeOpportunities);
  const [profile, personal, team, opportunities] = await Promise.all([
    client.from('profiles').select('full_name').eq('id', scope.userId).maybeSingle(),
    readPersonal(client, scope, week, now),
    roles.includes('team') ? readTeam(client, scope.organizationId, week) : Promise.resolve(null),
    roles.includes('opportunities') ? readOpportunities(client, scope.organizationId, week, now) : Promise.resolve(null),
  ]);
  const name = String((profile as any).data?.full_name || '').trim().split(/\s+/)[0] || '';
  const report: WeeklyReport = { week, roles, name, personal, team, opportunities };
  return { report, admin, managers };
}

// ─── Settings: the email on Mondays, and who manages Oportunidades ──────────────────────────────────────────────────

export function readReportEmail(signatures: unknown) {
  const settings = (signatures as any)?.weekly_report;
  return Boolean(settings && typeof settings === 'object' && settings.email === true);
}

/** On or off, keeping the rest of the person's signatures. */
export async function saveReportEmail(client: Client, userId: string, on: boolean) {
  const current: any = await client.from('profiles').select('signatures').eq('id', userId).maybeSingle();
  if (current.error) throw new WeeklyReportError('No pudimos leer tu perfil.', 503);
  const signatures = current.data?.signatures && typeof current.data.signatures === 'object' ? current.data.signatures : {};
  const saved = await client.from('profiles').update({ signatures: { ...signatures, weekly_report: { ...(signatures.weekly_report || {}), email: on } } }).eq('id', userId);
  if (saved.error) throw new WeeklyReportError('No pudimos guardar tu preferencia.', 503);
  return { email: on };
}

/** Replaces the managers of Oportunidades with the members given; only for owners and admins. */
export async function saveOpportunityManagers(client: Client, scope: ReportScope, userIds: string[]) {
  const member: any = await client.from('organization_members').select('role').eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (member.error || !['owner', 'admin'].includes(String(member.data?.role))) throw new WeeklyReportError('Solo un administrador puede elegir a los gestores.', 403);
  const wanted = [...new Set(userIds)].slice(0, 20);
  if (wanted.length) {
    const members: any = await client.from('organization_members').select('user_id').eq('organization_id', scope.organizationId).in('user_id', wanted);
    if (members.error || (members.data || []).length !== wanted.length) throw new WeeklyReportError('Elige personas de tu organización.', 400);
  }
  const removed = await client.from('organization_report_roles').delete().eq('organization_id', scope.organizationId).eq('role', 'opportunities');
  if (removed.error) throw new WeeklyReportError(MISSING.has(String(removed.error.code)) ? 'Los gestores aún no están disponibles.' : 'No pudimos guardar los gestores.', 503);
  if (wanted.length) {
    const inserted = await client.from('organization_report_roles').insert(wanted.map(userId => ({ organization_id: scope.organizationId, user_id: userId, role: 'opportunities', assigned_by: scope.userId })));
    if (inserted.error) throw new WeeklyReportError('No pudimos guardar los gestores.', 503);
  }
  return { managers: wanted };
}

// ─── Monday's email, from the person's own mailbox to themselves ─────────────────────────────────────────────────────

export type SendSelf = (input: { userId: string; to: string; subject: string; html: string; text: string }) => Promise<{ ok: true } | { ok: false; error: string }>;

/**
 * One person's report of last week, stored once per week and sent once: a second run the same Monday finds it sent and
 * does nothing. Without a mailbox connected or with the email off, it is stored and not sent.
 */
export async function deliverWeeklyReport(client: Client, scope: ReportScope, deps: { send: SendSelf; appUrl: string; canSeeOpportunities: () => Promise<boolean>; now?: Date }) {
  const { report } = await buildWeeklyReport(client, scope, { which: 'previous', canSeeOpportunities: deps.canSeeOpportunities, now: deps.now });
  const existing: any = await client.from('weekly_reports').select('id,emailed_at').eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('week_start', report.week.start).maybeSingle();
  if (existing.error) throw new WeeklyReportError('No pudimos guardar el informe.', 503);
  if (existing.data?.emailed_at) return { status: 'already_sent' as const };
  const stored: any = await client.from('weekly_reports').upsert({ organization_id: scope.organizationId, user_id: scope.userId, week_start: report.week.start,
    payload: report, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,user_id,week_start' }).select('id').single();
  if (stored.error) throw new WeeklyReportError('No pudimos guardar el informe.', 503);
  const profile: any = await client.from('profiles').select('email,signatures').eq('id', scope.userId).maybeSingle();
  const to = String(profile.data?.email || '').trim();
  if (!readReportEmail(profile.data?.signatures) || !to) return { status: 'stored' as const };
  const email = reportEmail(report, deps.appUrl);
  const sent = await deps.send({ userId: scope.userId, to, ...email });
  await client.from('weekly_reports').update(sent.ok ? { emailed_at: new Date().toISOString(), email_error: null } : { email_error: sent.error.slice(0, 300) }).eq('id', stored.data.id);
  return { status: sent.ok ? 'sent' as const : 'failed' as const };
}
