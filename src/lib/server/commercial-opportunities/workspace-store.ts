import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { isOpportunityAdmin, type WorkScope, type WorkspaceOverview, type WorkItem, type WorkRecord, type privateOpportunitySchema, type assignmentSchema } from '@/lib/commercial-opportunities/workspace';
import type { z } from 'zod';
import { reportJobProgress } from '@/lib/commercial-opportunities/report-progress';
import { assertOpportunityRead, assertOpportunityAdmin, readableOpportunityIds } from './workspace-access';

export function opportunityDb<T>(result: { data: T; error: { code?: string; message?: string } | null }): T {
  if (result.error) {
    if (result.error.code === '40001') throw new AuthError('El equipo cambió mientras editabas. Actualiza y vuelve a intentarlo.', 409);
    throw new AuthError('No se pudo completar la acción de Oportunidades.', 503);
  }
  return result.data;
}
const COLUMNS = 'id,kind,title,company_name,buyer_name,company_domain,url,score,reasons,deadline_at,amount,currency,data,updated_at';
export async function workspaceMembers(client: SupabaseClient, scope: WorkScope) {
  const rows = opportunityDb(await client.from('organization_members').select('user_id,role').eq('organization_id', scope.organizationId).limit(1000)) || [];
  if (!rows.length) return [];
  const profiles = opportunityDb(await client.from('profiles').select('id,full_name').in('id', rows.map(r => r.user_id))) || [];
  const names = new Map(profiles.map(p => [p.id, p.full_name]));
  return rows.map(row => ({ user_id: row.user_id, role: row.role, name: String(names.get(row.user_id) || 'Integrante') }));
}
export async function readWorkspaceOverview(client: SupabaseClient, scope: WorkScope, options: { view?: string; query?: string; page?: number } = {}): Promise<WorkspaceOverview> {
  const admin = isOpportunityAdmin(scope.role);
  const period = new Date().toISOString().slice(0, 7) + '-01';
  // The reads do not depend on each other, so they go together (one after another they took ~2.7 s of the page's load);
  // only the work records wait for the list.
  const [ids, items, notifications, groups, context, budget, members] = await Promise.all([
    readableOpportunityIds(client, scope),
    client.rpc('opportunity_workspace_list', { p_org: scope.organizationId, p_user: scope.userId, p_view: options.view || 'all', p_query: options.query || '', p_page: options.page || 0 })
      .then(result => (opportunityDb(result) as WorkItem[]) || []),
    client.from('opportunity_notifications').select('id,opportunity_id,title,created_at,read_at')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).order('created_at', { ascending: false }).limit(100).then(result => opportunityDb(result) || []),
    admin ? client.from('organization_reporting_groups').select('id,name').eq('organization_id', scope.organizationId).eq('is_active', true).then(result => opportunityDb(result) || []) : [],
    admin ? client.from('opportunity_company_context').select('*').eq('organization_id', scope.organizationId).maybeSingle().then(result => opportunityDb(result)) : null,
    admin ? client.from('opportunity_budget_months').select('spent_micro_usd,reserved_micro_usd').eq('organization_id', scope.organizationId).eq('period', period).maybeSingle()
      .then(result => opportunityDb(result)) : null,
    admin ? workspaceMembers(client, scope) : [],
  ]);
  const itemIds = items.map(item => item.id);
  const work = itemIds.length ? opportunityDb(await client.from('opportunity_work').select('*').eq('organization_id', scope.organizationId).in('opportunity_id', itemIds)) as WorkRecord[] : [];
  return { mode: admin ? 'management' : 'assigned', items, work: work || [], notifications: notifications.filter(n => ids === null || ids.includes(n.opportunity_id)),
    members, groups, context,
    budget: { spent: Number(budget?.spent_micro_usd || 0) / 1e6, reserved: Number(budget?.reserved_micro_usd || 0) / 1e6, cap: 20 },
    sourceStatus: admin ? { claude: Boolean(process.env.ANTHROPIC_API_KEY), linkedin: Boolean(process.env.APIFY_TOKEN), posts: Boolean(process.env.APIFY_TOKEN && process.env.OPPORTUNITIES_POST_USD_PER_ITEM),
      jsearch: Boolean(process.env.JSEARCH_API_KEY), automation: process.env.OPPORTUNITIES_AUTOMATION_ENABLED === 'true' } : {} };
}
export async function createPrivateOpportunity(client: SupabaseClient, scope: WorkScope, input: z.infer<typeof privateOpportunitySchema>) {
  assertOpportunityAdmin(scope);
  const requestId=input.requestId||randomUUID();const key=`private:${scope.userId}:${requestId}`;
  const existing=opportunityDb(await client.from('commercial_opportunities').select('id').eq('organization_id',scope.organizationId).eq('kind','private').eq('dedupe_key',key).maybeSingle());
  let id = existing?.id || randomUUID();
  if(!existing){
   const inserted=await client.from('commercial_opportunities').insert({ id, organization_id: scope.organizationId, kind: 'private', dedupe_key: key,
    title: input.title, company_name: input.company, buyer_name: input.company, deadline_at: input.deadline, amount: input.amount, currency: input.currency,
    url: input.url, reasons: ['Recibida directamente por el equipo'], data: { origin: 'admin_upload', evaluation: 'review', type: input.kind, description: input.description.slice(0, 2000), createdBy: scope.userId } });
   if(inserted.error?.code==='23505'){
    const won=opportunityDb(await client.from('commercial_opportunities').select('id').eq('organization_id',scope.organizationId).eq('kind','private').eq('dedupe_key',key).single());
    if(!won)throw new AuthError('No se pudo recuperar la oportunidad recibida.',503);id=won.id;
   }else opportunityDb(inserted);
  }
  if (input.description) {
    const { saveOpportunityDocument } = await import('./workspace-documents');
    await saveOpportunityDocument(client, scope, id, { name: 'Invitación recibida.txt', bytes: Buffer.from(input.description), sourceKind: 'pasted' });
  }
  await addOpportunityActivity(client, scope, id, 'created', 'Oportunidad recibida incorporada al workspace',{},`private-created:${id}`);
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
    if (!team) throw new AuthError('El equipo no pertenece a este workspace.', 400);
    const members = opportunityDb(await client.from('organization_reporting_group_members').select('user_id').eq('organization_id', scope.organizationId).eq('group_id', input.teamId).is('unassigned_at', null)) || [];
    members.forEach(member => users.add(member.user_id));
  }
  if (users.size > 50) throw new AuthError('El equipo de trabajo admite hasta 50 participantes.', 400);
  return opportunityDb(await client.rpc('opportunity_assign', { p_org: scope.organizationId, p_actor: scope.userId, p_id: id, p_revision: input.expectedRevision,
    p_team: input.teamId, p_users: [...users], p_responsible: input.responsibleId, p_objective: input.objective, p_due: input.dueAt }));
}
export async function readOpportunityDetail(client: SupabaseClient, scope: WorkScope, id: string) {
  await assertOpportunityRead(client, scope, id);
  const item = opportunityDb(await client.from('commercial_opportunities').select(COLUMNS).eq('organization_id', scope.organizationId).eq('id', id).single()) as WorkItem;
  const scoped = (table: string) => client.from(table).select('*').eq('organization_id', scope.organizationId).eq('opportunity_id', id);
  const [work, participants, activity, tasks, documents, reports, jobs, contacts] = await Promise.all([
    scoped('opportunity_work').maybeSingle(), scoped('opportunity_participants'), scoped('opportunity_activity').order('created_at', { ascending: false }).limit(200),
    scoped('opportunity_tasks').order('due_at', { ascending: true }), scoped('opportunity_documents').order('created_at'),
    scoped('opportunity_reports').order('created_at', { ascending: false }).limit(5),
    client.from('opportunity_jobs').select('id,kind,state,error,created_at,updated_at,requested_by,payload').eq('organization_id',scope.organizationId).eq('opportunity_id',id)
      .or(`kind.neq.chat,requested_by.eq.${scope.userId}`).order('created_at',{ascending:false}).limit(20), scoped('opportunity_contact_links'),
  ]);
  const people = opportunityDb(participants) || [];
  const members = await workspaceMembers(client, scope);
  const context = opportunityDb(await client.from('opportunity_company_context').select('criteria').eq('organization_id', scope.organizationId).maybeSingle());
  return { item, work: opportunityDb(work), decisionMakerTitles: context?.criteria?.decisionMakerTitles || [], participants: members.filter(m => people.some(p => p.user_id === m.user_id)),
    members: members.map(({ user_id, name }) => ({ user_id, name })),
    activity: opportunityDb(activity), tasks: opportunityDb(tasks), documents: opportunityDb(documents)?.map(({ storage_path, ...doc }) => doc),
    reports: opportunityDb(reports), contacts: opportunityDb(contacts),
    // A report's progress for the page's «oficina»; the payload itself never leaves the server.
    jobs: (opportunityDb(jobs) || []).map(({ payload, ...job }) => job.kind === 'research' ? { ...job, progress: reportJobProgress(job.state, payload) } : job) };
}
