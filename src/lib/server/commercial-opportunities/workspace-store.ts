import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { DISCOVERY_JOB_KINDS, OPPORTUNITY_MONTHLY_MICRO_USD, isOpportunityAdmin, type WorkScope, type WorkspaceOverview, type WorkItem, type WorkRecord, type privateOpportunitySchema, type assignmentSchema } from '@/lib/commercial-opportunities/workspace';
import type { z } from 'zod';
import { reportJobProgress } from '@/lib/commercial-opportunities/report-progress';
import { marksFromRows, type ReportMarks } from '@/lib/commercial-opportunities/report-marks';
import { companyDocumentAlerts } from '@/lib/commercial-opportunities/company-documents';
import { categoryTerms } from '@/lib/commercial-opportunities/workspace-radar';
import { adminViewCounts, listViewQuery, memberViewCounts } from '@/lib/commercial-opportunities/list-stages';
import { waitingLine } from '@/lib/commercial-opportunities/waiting';
import { assertOpportunityRead, assertOpportunityAdmin, readableOpportunityIds } from './workspace-access';
import { readWaitingOnAdmins } from './workspace-waiting';
import { readSearchHealth } from './workspace-source-health';

/** One page of the list: 100 opportunities, or the size a stage of the pipeline asks for. */
export const LIST_PAGE = 100;
export type WorkspacePageOptions = { view?: string; query?: string; page?: number; kinds?: string[]; categories?: string[]; sort?: string; limit?: number };
/**
 * A page of the opportunities this person can read (opportunity_workspace_page): the stages and evaluations of the view
 * (list-stages.ts), the words searched, the sources (kinds) and the lines of service (rubros).
 */
export async function readWorkspacePage(client: SupabaseClient, scope: WorkScope, options: WorkspacePageOptions = {}) {
  const filter = listViewQuery(options.view || 'all', isOpportunityAdmin(scope.role));
  const limit = Math.min(600, Math.max(1, options.limit ?? LIST_PAGE));
  return (opportunityDb(await client.rpc('opportunity_workspace_page', { p_org: scope.organizationId, p_user: scope.userId, p_stages: filter.stages,
    p_evaluations: filter.evaluations, p_query: String(options.query || '').trim().slice(0, 200), p_kinds: options.kinds || [], p_terms: categoryTerms(options.categories || []),
    p_biddable: filter.biddable, p_sort: options.sort || 'priority', p_limit: limit, p_offset: Math.max(0, Math.min(options.page || 0, 1000)) * limit })) || []) as WorkItem[];
}
/**
 * How many there are in each stage (and, of what nobody works yet, each evaluation) with the same words, sources and lines of service:
 * the numbers of the filters. A count that fails leaves the filters without numbers, never the page without its list.
 */
export async function readWorkspaceCounts(client: SupabaseClient, scope: WorkScope, options: Pick<WorkspacePageOptions, 'query' | 'kinds' | 'categories'> = {}) {
  const { data, error } = await client.rpc('opportunity_workspace_counts', { p_org: scope.organizationId, p_user: scope.userId, p_query: String(options.query || '').trim().slice(0, 200),
    p_kinds: options.kinds || [], p_terms: categoryTerms(options.categories || []), p_biddable: true });
  if (error) return null;
  return ((data || []) as Array<{ stage: string; evaluation: string | null; total: number | string }>).map(group => ({ ...group, total: Number(group.total) || 0 }));
}

export function opportunityDb<T>(result: { data: T; error: { code?: string; message?: string } | null }): T {
  if (result.error) {
    if (result.error.code === '40001') throw new AuthError('El equipo cambió mientras editabas. Actualiza y vuelve a intentarlo.', 409);
    throw new AuthError('No se pudo completar la acción de Oportunidades.', 503);
  }
  return result.data;
}
const COLUMNS = 'id,kind,title,company_name,buyer_name,company_domain,company_linkedin_url,url,score,reasons,deadline_at,amount,currency,data,updated_at';
export async function workspaceMembers(client: SupabaseClient, scope: WorkScope) {
  const rows = opportunityDb(await client.from('organization_members').select('user_id,role').eq('organization_id', scope.organizationId).limit(1000)) || [];
  if (!rows.length) return [];
  const profiles = opportunityDb(await client.from('profiles').select('id,full_name,email').in('id', rows.map(r => r.user_id))) || [];
  // Whoever has no name yet (the app asks for it when they open it) is listed by their email, never as a stranger.
  const names = new Map(profiles.map(p => [p.id, String(p.full_name || '').trim() || String(p.email || '').trim()]));
  return rows.map(row => ({ user_id: row.user_id, role: row.role, name: names.get(row.user_id) || 'Integrante' }));
}
export async function readWorkspaceOverview(client: SupabaseClient, scope: WorkScope, options: WorkspacePageOptions = {}): Promise<WorkspaceOverview> {
  const admin = isOpportunityAdmin(scope.role);
  const period = new Date().toISOString().slice(0, 7) + '-01';
  // The reads do not depend on each other, so they go together (one after another they took ~2.7 s of the page's load);
  // only the work records wait for the list.
  const [ids, items, counts, notifications, groups, context, budget, members, documentAlerts, searching, waiting, health] = await Promise.all([
    readableOpportunityIds(client, scope),
    readWorkspacePage(client, scope, options),
    readWorkspaceCounts(client, scope, options),
    client.from('opportunity_notifications').select('id,opportunity_id,title,created_at,read_at,kind')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).order('created_at', { ascending: false }).limit(100).then(result => opportunityDb(result) || []),
    admin ? client.from('organization_reporting_groups').select('id,name').eq('organization_id', scope.organizationId).eq('is_active', true).then(result => opportunityDb(result) || []) : [],
    admin ? client.from('opportunity_company_context').select('*').eq('organization_id', scope.organizationId).maybeSingle().then(result => opportunityDb(result)) : null,
    admin ? client.from('opportunity_budget_months').select('spent_micro_usd,reserved_micro_usd').eq('organization_id', scope.organizationId).eq('period', period).maybeSingle()
      .then(result => opportunityDb(result)) : null,
    admin ? workspaceMembers(client, scope) : [],
    // «Tu F30 vence en 5 días»: the company's documents lapsed or about to (none before their migration).
    admin ? client.from('opportunity_company_documents').select('id,label,expires_at').eq('organization_id', scope.organizationId).not('expires_at', 'is', null).limit(100)
      .then(result => result.error ? [] : companyDocumentAlerts((result.data || []).map((row: any) => ({ id: row.id, label: row.label, expiresAt: row.expires_at })))) : [],
    // «Buscando en licitaciones…» while «Actualizar oportunidades» or the daily search runs; a failed read just leaves it out.
    admin ? client.from('opportunity_jobs').select('kind').eq('organization_id', scope.organizationId).in('kind', [...DISCOVERY_JOB_KINDS])
      .in('state', ['queued', 'running', 'waiting']).limit(20).then(result => result.error ? [] : [...new Set((result.data || []).map((row: any) => String(row.kind)))]) : [],
    // «Esperan tu respuesta» in «Novedades»: the decisions and blocks no administrator has answered, until one does. A failed read leaves it out.
    admin ? readWaitingOnAdmins(client, scope.organizationId).then(found => {
      const now = new Date();
      return { total: found.length, lines: found.slice(0, 5).map(item => ({ ...waitingLine(item, now, true), kind: item.kind })) };
    }).catch(() => null) : null,
    // How each source of the daily search went (OPP-15); a failed read leaves the strip as it was.
    admin ? readSearchHealth(client, scope.organizationId).catch(() => null) : null,
  ]);
  const itemIds = items.map(item => item.id);
  const work = itemIds.length ? opportunityDb(await client.from('opportunity_work').select('*').eq('organization_id', scope.organizationId).in('opportunity_id', itemIds)) as WorkRecord[] : [];
  return { mode: admin ? 'management' : 'assigned', items, work: work || [], notifications: notifications.filter(n => ids === null || ids.includes(n.opportunity_id)),
    members, groups, context, documentAlerts, ...(admin ? { searching } : {}), ...(waiting?.total ? { waiting } : {}), ...(health ? { health } : {}), ...(counts ? { counts: admin ? adminViewCounts(counts) : memberViewCounts(counts) } : {}),
    budget: { spent: Number(budget?.spent_micro_usd || 0) / 1e6, reserved: Number(budget?.reserved_micro_usd || 0) / 1e6, cap: OPPORTUNITY_MONTHLY_MICRO_USD / 1e6 },
    sourceStatus: admin ? { claude: Boolean(process.env.ANTHROPIC_API_KEY), linkedin: Boolean(process.env.APIFY_TOKEN), posts: Boolean(process.env.APIFY_TOKEN && process.env.OPPORTUNITIES_POST_USD_PER_ITEM),
      jsearch: Boolean(process.env.JSEARCH_API_KEY), automation: process.env.OPPORTUNITIES_AUTOMATION_ENABLED === 'true' } : {} };
}
/**
 * `options` names where the opportunity came from when it was not received by the team (a line of the purchase plan, for
 * one), and `dedupeKey` makes it one per workspace whoever adds it.
 */
export async function createPrivateOpportunity(client: SupabaseClient, scope: WorkScope, input: z.infer<typeof privateOpportunitySchema>,
  options: { reason?: string; origin?: string; documentName?: string; dedupeKey?: string; activity?: string } = {}) {
  assertOpportunityAdmin(scope);
  const requestId=input.requestId||randomUUID();const key=options.dedupeKey||`private:${scope.userId}:${requestId}`;
  const existing=opportunityDb(await client.from('commercial_opportunities').select('id').eq('organization_id',scope.organizationId).eq('kind','private').eq('dedupe_key',key).maybeSingle());
  let id = existing?.id || randomUUID();
  if(!existing){
   const inserted=await client.from('commercial_opportunities').insert({ id, organization_id: scope.organizationId, kind: 'private', dedupe_key: key,
    title: input.title, company_name: input.company, buyer_name: input.company, deadline_at: input.deadline, amount: input.amount, currency: input.currency,
    url: input.url, reasons: [options.reason || 'Recibida directamente por el equipo'], data: { origin: options.origin || 'admin_upload', evaluation: 'review', type: input.kind, description: input.description.slice(0, 2000), createdBy: scope.userId } });
   if(inserted.error?.code==='23505'){
    const won=opportunityDb(await client.from('commercial_opportunities').select('id').eq('organization_id',scope.organizationId).eq('kind','private').eq('dedupe_key',key).single());
    if(!won)throw new AuthError('No se pudo recuperar la oportunidad recibida.',503);id=won.id;
   }else opportunityDb(inserted);
  }
  if (input.description) {
    const { saveOpportunityDocument } = await import('./workspace-documents');
    await saveOpportunityDocument(client, scope, id, { name: options.documentName || 'Invitación recibida.txt', bytes: Buffer.from(input.description), sourceKind: 'pasted' });
  }
  await addOpportunityActivity(client, scope, id, 'created', options.activity || 'Oportunidad recibida incorporada a la organización',{},`private-created:${id}`);
  return id;
}
export async function addOpportunityActivity(client: SupabaseClient, scope: WorkScope, id: string, kind: string, body: string, data: Record<string, unknown> = {}, eventKey?: string) {
  await assertOpportunityRead(client, scope, id);
  opportunityDb(await client.from('opportunity_activity').upsert({ organization_id: scope.organizationId, opportunity_id: id, actor_id: scope.userId, kind,
    body, data, event_key: eventKey || randomUUID() }, { onConflict: 'organization_id,event_key', ignoreDuplicates: true }));
}
export async function assignOpportunity(client: SupabaseClient, scope: WorkScope, id: string, input: z.infer<typeof assignmentSchema>) {
  assertOpportunityAdmin(scope);
  const users = new Set(input.participantIds);
  if (input.teamId) {
    const team = opportunityDb(await client.from('organization_reporting_groups').select('id').eq('organization_id', scope.organizationId).eq('id', input.teamId).eq('is_active', true).maybeSingle());
    if (!team) throw new AuthError('El equipo no pertenece a esta organización.', 400);
    const members = opportunityDb(await client.from('organization_reporting_group_members').select('user_id').eq('organization_id', scope.organizationId).eq('group_id', input.teamId).is('unassigned_at', null)) || [];
    members.forEach(member => users.add(member.user_id));
  }
  if (users.size > 50) throw new AuthError('El equipo de trabajo admite hasta 50 participantes.', 400);
  return opportunityDb(await client.rpc('opportunity_assign', { p_org: scope.organizationId, p_actor: scope.userId, p_id: id, p_revision: input.expectedRevision,
    p_team: input.teamId, p_users: [...users], p_responsible: input.responsibleId, p_objective: input.objective, p_due: input.dueAt }));
}
/**
 * What the team marked on the report (done, highlighted, notes). Before the table exists (a deploy ahead of its
 * migration) the report shows without marks instead of failing.
 */
export async function readOpportunityReportMarks(client: SupabaseClient, scope: WorkScope, id: string): Promise<{ available: boolean; items: ReportMarks }> {
  const { data, error } = await client.from('opportunity_report_marks').select('item_key,done,highlight,note,updated_by,updated_at')
    .eq('organization_id', scope.organizationId).eq('opportunity_id', id).limit(1000);
  if (error) {
    if (['42P01', 'PGRST205'].includes(String((error as { code?: string }).code))) return { available: false, items: {} };
    throw error;
  }
  return { available: true, items: marksFromRows(data) };
}
/**
 * One mark on the report: done, highlighted or its note, merged with what was there. Done and notes leave a line in the
 * activity, once per item and state, so the team sees who moved what; a highlight is personal reading aid and does not.
 */
export async function saveOpportunityReportMark(client: SupabaseClient, scope: WorkScope, id: string,
  input: { key: string; label: string; done?: boolean; highlight?: boolean; note?: string }) {
  await assertOpportunityRead(client, scope, id);
  const current = opportunityDb(await client.from('opportunity_report_marks').select('done,highlight,note')
    .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('item_key', input.key).maybeSingle()) as { done: boolean; highlight: boolean; note: string } | null;
  const next = { done: input.done ?? current?.done ?? false, highlight: input.highlight ?? current?.highlight ?? false, note: (input.note ?? current?.note ?? '').trim() };
  const saved = opportunityDb(await client.from('opportunity_report_marks').upsert({ organization_id: scope.organizationId, opportunity_id: id, item_key: input.key,
    ...next, updated_by: scope.userId, updated_at: new Date().toISOString() }, { onConflict: 'opportunity_id,item_key' }).select('item_key,done,highlight,note,updated_by,updated_at').single());
  const label = input.label.slice(0, 160);
  if (input.done !== undefined && input.done !== (current?.done ?? false))
    await addOpportunityActivity(client, scope, id, 'report_mark', `${input.done ? 'Listo' : 'Pendiente de nuevo'}: ${label}`, { key: input.key });
  if (input.note !== undefined && next.note && next.note !== (current?.note ?? ''))
    await addOpportunityActivity(client, scope, id, 'report_note', `Nota en «${label}»: ${next.note.slice(0, 300)}`, { key: input.key });
  return marksFromRows(saved ? [saved] : [])[input.key] ?? null;
}
export async function readOpportunityDetail(client: SupabaseClient, scope: WorkScope, id: string) {
  await assertOpportunityRead(client, scope, id);
  const item = opportunityDb(await client.from('commercial_opportunities').select(COLUMNS).eq('organization_id', scope.organizationId).eq('id', id).single()) as WorkItem;
  const scoped = (table: string) => client.from(table).select('*').eq('organization_id', scope.organizationId).eq('opportunity_id', id);
  const [work, participants, activity, tasks, documents, reports, jobs, contacts, marks] = await Promise.all([
    scoped('opportunity_work').maybeSingle(), scoped('opportunity_participants'), scoped('opportunity_activity').order('created_at', { ascending: false }).limit(200),
    scoped('opportunity_tasks').order('due_at', { ascending: true }), scoped('opportunity_documents').order('created_at'),
    scoped('opportunity_reports').order('created_at', { ascending: false }).limit(5),
    client.from('opportunity_jobs').select('id,kind,state,error,created_at,updated_at,requested_by,payload').eq('organization_id',scope.organizationId).eq('opportunity_id',id)
      .or(`kind.neq.chat,requested_by.eq.${scope.userId}`).order('created_at',{ascending:false}).limit(40), scoped('opportunity_contact_links'),
    readOpportunityReportMarks(client, scope, id),
  ]);
  const people = opportunityDb(participants) || [];
  const members = await workspaceMembers(client, scope);
  const context = opportunityDb(await client.from('opportunity_company_context').select('criteria').eq('organization_id', scope.organizationId).maybeSingle());
  return { item, work: opportunityDb(work), decisionMakerTitles: context?.criteria?.decisionMakerTitles || [], participants: members.filter(m => people.some(p => p.user_id === m.user_id)),
    members: members.map(({ user_id, name }) => ({ user_id, name })),
    activity: opportunityDb(activity), tasks: opportunityDb(tasks), documents: opportunityDb(documents)?.map(({ storage_path, ...doc }) => doc),
    reports: opportunityDb(reports), contacts: opportunityDb(contacts), marks,
    // A report's progress for the page's «oficina»; the payload itself never leaves the server.
    jobs: (opportunityDb(jobs) || []).map(({ payload, ...job }) => job.kind === 'research' ? { ...job, progress: reportJobProgress(job.state, payload) }
      // Which document an image or scan reading is about, so the expediente can say «La IA lo está leyendo».
      : payload?.scan && typeof payload.documentId === 'string' ? { ...job, documentId: payload.documentId } : job) };
}
