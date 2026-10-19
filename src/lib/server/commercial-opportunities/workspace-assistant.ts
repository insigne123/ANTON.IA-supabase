// The «Asistente» of Oportunidades: a person's conversations about the whole section, answered with the opportunities that
// person can see (the same list and permissions as the page) and, for admins, the future demand. A question about one
// opportunity is handed to that opportunity's chat, which reads its documents.
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { isOpportunityAdmin, type WorkScope, type WorkItem, type WorkRecord } from '@/lib/commercial-opportunities/workspace';
import { assistantAnswerSchema, assistantItem, assistantKeywords, assistantPrompt, assistantThreadTitle, resolveAssistantAnswer,
  type AssistantMessage, type AssistantThread, type SavedAssistantAnswer } from '@/lib/commercial-opportunities/assistant';
import { opportunityDb } from './workspace-store';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';
import { humanDay, type ExpiringContract } from '@/lib/public-procurement/contracts';
import { loadCompanyForModel } from './tender-profile-read';
import { readableOpportunityIds } from './workspace-access';

const THREADS = 'opportunity_assistant_threads';
const MESSAGES = 'opportunity_assistant_messages';
/** How many opportunities the model reads: enough for a section's question, small enough for a quick, cheap answer. */
const MAX_ITEMS = 60;
const CLOSED = new Set(['won', 'lost', 'archived']);

async function ownThread(client: SupabaseClient, scope: WorkScope, threadId: string) {
  const thread = opportunityDb(await client.from(THREADS).select('id,title,updated_at').eq('organization_id', scope.organizationId)
    .eq('user_id', scope.userId).eq('id', threadId).maybeSingle()) as AssistantThread | null;
  if (!thread) throw new AuthError('Esa conversación ya no existe.', 404);
  return thread;
}

/** A question: in its thread (a new one when none is given), saved before it is answered, so a reload still shows it. */
export async function askOpportunityAssistant(client: SupabaseClient, scope: WorkScope, input: { question: string; requestId: string; threadId?: string | null }) {
  // A retried request keeps the thread of its first message, and never opens a second, empty one.
  const prior = opportunityDb(await client.from(MESSAGES).select('thread_id').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .eq('request_id', input.requestId).maybeSingle()) as { thread_id: string } | null;
  if (prior && input.threadId && prior.thread_id !== input.threadId) throw new AuthError('La pregunta pertenece a otra conversación.', 409);
  const threadId = prior?.thread_id ?? (input.threadId
    ? (await ownThread(client, scope, input.threadId)).id
    : (opportunityDb(await client.from(THREADS).insert({ organization_id: scope.organizationId, user_id: scope.userId, title: assistantThreadTitle(input.question) })
      .select('id').single()) as { id: string }).id);
  if (!prior) opportunityDb(await client.from(MESSAGES).upsert({ organization_id: scope.organizationId, thread_id: threadId, user_id: scope.userId,
    request_id: input.requestId, question: input.question }, { onConflict: 'organization_id,user_id,request_id', ignoreDuplicates: true }));
  const key = `assistant:${scope.userId}:${input.requestId}`;
  opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, requested_by: scope.userId,
    kind: 'assistant', dedupe_key: key, payload: { requestId: input.requestId, threadId } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }));
  opportunityDb(await client.from(THREADS).update({ updated_at: new Date().toISOString() }).eq('organization_id', scope.organizationId).eq('id', threadId));
  return { threadId, key };
}

/** The opportunities a question is about: what fits, what the team works, and what its words find in titles and buyers. */
async function assistantItems(client: SupabaseClient, scope: WorkScope, question: string) {
  const list = async (view: string, query = '') => (opportunityDb(await client.rpc('opportunity_workspace_list',
    { p_org: scope.organizationId, p_user: scope.userId, p_view: view, p_query: query, p_page: 0 })) || []) as WorkItem[];
  const words = assistantKeywords(question);
  const groups = await Promise.all([
    ...words.map(word => list('all', word)),
    list('recommended'),
    ...(isOpportunityAdmin(scope.role) ? [list('assigned')] : []),
    list('all'),
  ]);
  const byId = new Map<string, WorkItem>();
  for (const group of groups) for (const item of group) if (byId.size < MAX_ITEMS && !byId.has(item.id)) byId.set(item.id, item);
  const items = [...byId.values()];
  const work = items.length ? (opportunityDb(await client.from('opportunity_work').select('opportunity_id,state').eq('organization_id', scope.organizationId)
    .in('opportunity_id', items.map(item => item.id))) || []) as Pick<WorkRecord, 'opportunity_id' | 'state'>[] : [];
  const states = new Map(work.map(row => [row.opportunity_id, row]));
  // What is open and closes soonest first: the model reads what the person can still act on before the rest.
  const now = Date.now();
  const rank = (item: WorkItem) => {
    const state = states.get(item.id)?.state;
    const deadline = item.deadline_at ? Date.parse(item.deadline_at) : NaN;
    if (state && CLOSED.has(state)) return 3;
    if (Number.isFinite(deadline) && deadline < now) return 2;
    return Number.isFinite(deadline) ? 0 : 1;
  };
  items.sort((a, b) => rank(a) - rank(b) || String(a.deadline_at || '9').localeCompare(String(b.deadline_at || '9')));
  return { items, states };
}

/** The plan lines that matter most for a conversation: the next months first, then the largest. Admins only. */
async function assistantDemand(client: SupabaseClient, scope: WorkScope) {
  if (!isOpportunityAdmin(scope.role)) return [];
  const result = await client.from('opportunity_purchase_plan').select('year,institution,description,amount,month').eq('organization_id', scope.organizationId)
    .order('year', { ascending: false }).order('amount', { ascending: false, nullsFirst: false }).limit(400);
  // Before its migration the table is missing: the conversation goes on without it.
  if (result.error) return [];
  const rows = (result.data || []) as Array<{ year: number; institution: string; description: string; amount: number | null; month: number | null }>;
  const year = rows[0]?.year;
  const month = Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Santiago' }).format(new Date()));
  const ofYear = rows.filter(row => row.year === year);
  const upcoming = ofYear.filter(row => row.month !== null && row.month >= month).sort((a, b) => (a.month! - b.month!) || (Number(b.amount) - Number(a.amount)));
  const rest = ofYear.filter(row => !upcoming.includes(row));
  const label = (m: number | null) => (m ? new Intl.DateTimeFormat('es-CL', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, m - 1, 15))) : 'sin mes');
  return [...upcoming.slice(0, 30), ...rest.slice(0, 10)].map(row => ({ organismo: row.institution.slice(0, 120), compra: row.description.slice(0, 160),
    monto: row.amount === null ? null : Number(row.amount), mes: `${label(row.month)} ${row.year}` }));
}

/** The contracts that end soonest, from the latest «Contratos por vencer» reading. Admins only, as the view. */
async function assistantContracts(client: SupabaseClient, scope: WorkScope) {
  if (!isOpportunityAdmin(scope.role)) return [];
  const result = await client.from('opportunity_jobs').select('result').eq('organization_id', scope.organizationId).eq('kind', 'contracts').eq('state', 'ready')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (result.error || !Array.isArray(result.data?.result?.contracts)) return [];
  return (result.data.result.contracts as ExpiringContract[]).filter(contract => contract.endsOn)
    .sort((a, b) => String(a.endsOn).localeCompare(String(b.endsOn))).slice(0, 25)
    .map(contract => ({ organismo: (contract.agency || '').slice(0, 120), contrato: contract.name.slice(0, 160), loTiene: contract.winnerName?.slice(0, 120) ?? null,
      monto: contract.currency === 'CLP' ? contract.amount : null, vence: humanDay(contract.endsOn) }));
}

/** The worker's side: reads what the person can see, asks Claude once, and keeps only the opportunities that exist. */
export async function runOpportunityAssistant(client: SupabaseClient, job: OpportunityJob): Promise<SavedAssistantAnswer> {
  const member = opportunityDb(await client.from('organization_members').select('role').eq('organization_id', job.organization_id).eq('user_id', job.requested_by).maybeSingle());
  if (!member) throw new AuthError('Ya no tienes acceso a este workspace.', 409);
  const scope: WorkScope = { organizationId: job.organization_id, userId: job.requested_by, role: member.role };
  const message = opportunityDb(await client.from(MESSAGES).select('id,thread_id,question,created_at').eq('organization_id', job.organization_id)
    .eq('user_id', job.requested_by).eq('request_id', job.payload.requestId).single()) as { id: string; thread_id: string; question: string; created_at: string };
  const [{ items, states }, demand, contracts, context, earlier, ficha] = await Promise.all([
    assistantItems(client, scope, message.question),
    assistantDemand(client, scope),
    assistantContracts(client, scope),
    client.from('opportunity_company_context').select('offer,services').eq('organization_id', job.organization_id).maybeSingle().then(result => opportunityDb(result)),
    // The conversation so far (the last six turns, oldest first), so «¿y cuál cierra primero?» reads as one.
    client.from(MESSAGES).select('question,answer,created_at').eq('organization_id', job.organization_id).eq('thread_id', message.thread_id)
      .lt('created_at', message.created_at).not('answer', 'is', null).order('created_at', { ascending: false }).limit(6)
      .then(result => (opportunityDb(result) || []) as Array<{ question: string; answer: SavedAssistantAnswer | null }>),
    loadCompanyForModel(client, job.organization_id),
  ]);
  const today = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' }).format(new Date());
  const conversation = earlier.reverse().map(turn => ({ pregunta: turn.question.slice(0, 600), respuesta: String(turn.answer?.answer || '').slice(0, 900) }));
  const answer = await opportunityGenerate(client, job, { step: 'answer', category: 'chat', role: 'chat', schema: assistantAnswerSchema, output: 3000,
    prompt: assistantPrompt({ question: message.question, today, admin: isOpportunityAdmin(scope.role), offer: String(context?.offer || ''),
      services: Array.isArray(context?.services) ? context.services.map(String) : [], items: items.map(item => assistantItem(item, states.get(item.id))), demand, contracts, conversation,
      ficha }) });
  const saved = resolveAssistantAnswer(answer, new Map(items.map(item => [item.id, { title: item.title, buyer: item.buyer_name || item.company_name,
    kind: item.kind, deadline: item.deadline_at }])));
  opportunityDb(await client.from(MESSAGES).update({ answer: saved }).eq('organization_id', job.organization_id).eq('id', message.id));
  opportunityDb(await client.from(THREADS).update({ updated_at: new Date().toISOString() }).eq('organization_id', job.organization_id).eq('id', message.thread_id));
  return saved;
}

/**
 * The sidebar: the person's conversations, and the opportunities where they already talked with the chat of one
 * («Por licitación»). `available` is false until the migration runs.
 */
export async function readOpportunityAssistant(client: SupabaseClient, scope: WorkScope) {
  const threads = await client.from(THREADS).select('id,title,updated_at').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('updated_at', { ascending: false }).limit(50);
  if (threads.error) return { available: false, threads: [], opportunities: [] };
  const chats = (opportunityDb(await client.from('opportunity_chat_messages').select('opportunity_id,created_at').eq('organization_id', scope.organizationId)
    .eq('user_id', scope.userId).order('created_at', { ascending: false }).limit(300)) || []) as Array<{ opportunity_id: string; created_at: string }>;
  const latest = new Map<string, string>();
  for (const chat of chats) if (!latest.has(chat.opportunity_id) && latest.size < 20) latest.set(chat.opportunity_id, chat.created_at);
  // Only the opportunities the person can still open: a reassigned one leaves the list.
  const readable = await readableOpportunityIds(client, scope);
  const ids = [...latest.keys()].filter(id => readable === null || readable.includes(id));
  const rows = ids.length ? (opportunityDb(await client.from('commercial_opportunities').select('id,title').eq('organization_id', scope.organizationId)
    .in('id', ids)) || []) as Array<{ id: string; title: string }> : [];
  const titles = new Map(rows.map(row => [row.id, row.title]));
  return { available: true, threads: (threads.data || []) as AssistantThread[],
    opportunities: ids.filter(id => titles.has(id)).map(id => ({ id, title: String(titles.get(id)), updated_at: latest.get(id)! })) };
}

/** A thread's messages; one still without an answer carries its job, so the page tells waiting from a failure. */
export async function readAssistantThread(client: SupabaseClient, scope: WorkScope, threadId: string) {
  const thread = await ownThread(client, scope, threadId);
  const rows = (opportunityDb(await client.from(MESSAGES).select('id,request_id,question,answer,created_at').eq('organization_id', scope.organizationId)
    .eq('user_id', scope.userId).eq('thread_id', threadId).order('created_at').limit(200)) || []) as Array<AssistantMessage & { request_id: string }>;
  const keys = rows.filter(row => !row.answer).map(row => `assistant:${scope.userId}:${row.request_id}`);
  const jobs = keys.length ? (opportunityDb(await client.from('opportunity_jobs').select('dedupe_key,state,error').eq('organization_id', scope.organizationId)
    .in('dedupe_key', keys)) || []) as Array<{ dedupe_key: string; state: string; error: string | null }> : [];
  const byKey = new Map(jobs.map(job => [job.dedupe_key, { state: job.state, error: job.error }]));
  const messages: AssistantMessage[] = rows.map(({ request_id, ...row }) => ({ ...row, requestId: request_id,
    job: row.answer ? null : byKey.get(`assistant:${scope.userId}:${request_id}`) ?? null }));
  return { thread, messages };
}

export async function deleteAssistantThread(client: SupabaseClient, scope: WorkScope, threadId: string) {
  await ownThread(client, scope, threadId);
  opportunityDb(await client.from(THREADS).delete().eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('id', threadId));
}
