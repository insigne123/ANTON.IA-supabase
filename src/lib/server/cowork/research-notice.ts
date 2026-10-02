import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { requireCoworkWorkerAccess } from './access';
import { deterministicCoworkUuid } from './deterministic-id';
import {
  COWORK_RESEARCH_NOTICE_EVENT, coworkResearchFinished, coworkResearchKey, coworkResearchNoticeDue, coworkResearchNoticeMessage,
  type CoworkResearchJob, type CoworkResearchNoticePerson,
} from '@/lib/cowork/research-notice';

/**
 * The research Cowork started, told back to its conversation when it finishes (lib/cowork/research-notice.ts). Runs with
 * the worker every minute. A notice is marked on the run that started the research before it is admitted, so nobody
 * hears it twice; a marked notice whose turn never got admitted is admitted on a later minute while its place is still
 * the end of the conversation.
 */

type Client = SupabaseClient;
type Scope = { userId: string; organizationId: string };
type Run = { id: string; status: string; mode: string | null; parent_run_id: string | null };
type Job = CoworkResearchJob & { originRunId: string; scope: Scope };
type Marker = { run_id: string; payload: { jobIds?: unknown; requestId?: unknown; parentRunId?: unknown; message?: unknown } | null };

const ACTIVE = new Set(['queued', 'running', 'waiting_approval', 'waiting_workers']);
const LOOKBACK_MS = 24 * 60 * 60_000;
const MAX_STEPS = 60;
const THROTTLE_MS = 20_000;
let lastCheck = 0;

/** The request id of a notice: the conversation shows it as an automatic turn (runs.ts) and a retry admits the same turn. */
export function coworkResearchNoticeRequestId(parentRunId: string) {
  return deterministicCoworkUuid(`cowork:research-notice:${parentRunId}`);
}

const RUN_FIELDS = 'id,status,mode,parent_run_id';
async function readRun(client: Client, scope: Scope, id: string): Promise<Run | null> {
  const { data, error } = await client.from('cowork_runs').select(RUN_FIELDS).eq('id', id)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  return error ? null : (data as Run | null);
}

/**
 * Where the notice of a research started in runId goes: after the newest turn of its conversation when that one
 * finished, nowhere yet while a turn is working (the next minute tries again), after the newest finished turn when the
 * last one failed or was cancelled.
 */
export async function coworkResearchNoticeParent(client: Client, scope: Scope, runId: string): Promise<Run | null> {
  let current = await readRun(client, scope, runId);
  if (!current) return null;
  const seen = new Set([current.id]);
  for (let step = 0; step < MAX_STEPS; step++) {
    const { data, error } = await client.from('cowork_runs').select(RUN_FIELDS).eq('parent_run_id', current.id)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) return null;
    const child = data as Run | null;
    if (!child || seen.has(child.id)) break;
    seen.add(child.id);
    current = child;
  }
  if (current.status === 'completed') return current;
  if (ACTIVE.has(current.status)) return null;
  for (let step = 0; step < MAX_STEPS && current.parent_run_id; step++) {
    const parent = await readRun(client, scope, current.parent_run_id);
    if (!parent) return null;
    if (parent.status === 'completed') return parent;
    current = parent;
  }
  return null;
}

async function admitNotice(client: Client, scope: Scope, parent: Pick<Run, 'id' | 'mode'>, requestId: string, message: string) {
  // A new start for the conversation, like a message: it does not spend the automatic steps of the turn before.
  const { data, error } = await client.rpc('cowork_admit_followup', {
    p_user_id: scope.userId, p_organization_id: scope.organizationId, p_request_id: requestId, p_message: message,
    p_mode: parent.mode === 'autonomous' ? 'autonomous' : 'approval', p_parent_run_id: parent.id, p_reset_depth: true,
  });
  return !error && typeof data === 'string';
}

/** Who each research is about: a saved contact or one of «Por escribir» (Plan 6, PR-C1). Best effort: a name that cannot be read is null. */
async function people(client: Client, scope: Scope, leadIds: string[]): Promise<Map<string, { name: string | null; company: string | null }>> {
  const ids = [...new Set(leadIds)];
  const found = new Map<string, { name: string | null; company: string | null }>();
  const { data } = await client.from('leads').select('id,name,company').in('id', ids)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId);
  for (const lead of (data || []) as Array<{ id: string; name: string | null; company: string | null }>) found.set(lead.id, { name: lead.name, company: lead.company });
  const missing = ids.filter(id => !found.has(id));
  if (!missing.length) return found;
  const enriched = await client.from('enriched_leads').select('id,full_name,company_name,organization_name').in('id', missing)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId);
  for (const row of (enriched.data || []) as Array<{ id: string; full_name: string | null; company_name: string | null; organization_name: string | null }>) {
    found.set(String(row.id), { name: row.full_name, company: row.company_name || row.organization_name || null });
  }
  return found;
}

/** One pass: tells every conversation whose research finished. Best effort; never throws. */
export async function processCoworkResearchNotices(options: { now?: Date; client?: Client; force?: boolean } = {}) {
  const now = options.now || new Date();
  if (!options.force && now.getTime() - lastCheck < THROTTLE_MS) return { notified: 0 };
  lastCheck = now.getTime();
  try {
    const client = options.client || getSupabaseAdminClient();
    const recent = await client.from('lead_research_jobs')
      .select('id,user_id,organization_id,status,error_code,created_at,request_idempotency_key')
      .like('request_idempotency_key', 'cowork:%').gte('created_at', new Date(now.getTime() - LOOKBACK_MS).toISOString())
      .order('created_at', { ascending: true }).limit(300);
    if (recent.error || !recent.data?.length) return { notified: 0 };
    const origins = new Map<string, Job[]>();
    for (const row of recent.data as Array<Record<string, unknown>>) {
      const key = coworkResearchKey(row.request_idempotency_key as string);
      if (!key || typeof row.user_id !== 'string' || typeof row.organization_id !== 'string') continue;
      const job: Job = { id: String(row.id), leadId: key.leadId, status: String(row.status || ''), errorCode: (row.error_code as string | null) || null,
        createdAt: String(row.created_at), originRunId: key.runId, scope: { userId: row.user_id, organizationId: row.organization_id } };
      origins.set(key.runId, [...(origins.get(key.runId) || []), job]);
    }
    if (!origins.size) return { notified: 0 };
    const marked = await client.from('cowork_run_events').select('run_id,payload').in('run_id', [...origins.keys()]).eq('kind', COWORK_RESEARCH_NOTICE_EVENT);
    // Without the markers a notice could be told twice: wait for the next minute.
    if (marked.error) return { notified: 0 };
    const markers = (marked.data || []) as Marker[];
    const told = new Set(markers.flatMap(marker => Array.isArray(marker.payload?.jobIds) ? marker.payload.jobIds.map(String) : []));
    let notified = await recoverNotices(client, origins, markers);

    // One notice per conversation, with everything that finished in it.
    const notices = new Map<string, { scope: Scope; parent: Run; due: Job[]; running: Job[] }>();
    for (const [runId, jobs] of origins) {
      const pending = jobs.filter(job => !told.has(job.id));
      const due = coworkResearchNoticeDue(pending, now);
      if (!due.length) continue;
      const scope = jobs[0].scope;
      const parent = await coworkResearchNoticeParent(client, scope, runId);
      if (!parent) continue;
      const notice = notices.get(parent.id) || { scope, parent, due: [], running: [] };
      notice.due.push(...due);
      notice.running.push(...pending.filter(job => !coworkResearchFinished(job.status)));
      notices.set(parent.id, notice);
    }
    for (const notice of notices.values()) {
      try {
        await requireCoworkWorkerAccess(client, notice.scope);
        const names = await people(client, notice.scope, [...notice.due, ...notice.running].map(job => job.leadId));
        const person = (job: Job): CoworkResearchNoticePerson => ({ leadId: job.leadId, name: names.get(job.leadId)?.name || null,
          company: names.get(job.leadId)?.company || null, status: job.status, errorCode: job.errorCode });
        const message = coworkResearchNoticeMessage(notice.due.slice(0, 30).map(person), notice.running.slice(0, 30).map(person));
        const requestId = coworkResearchNoticeRequestId(notice.parent.id);
        const byOrigin = new Map<string, string[]>();
        for (const job of notice.due) byOrigin.set(job.originRunId, [...(byOrigin.get(job.originRunId) || []), job.id]);
        const marking = await client.from('cowork_run_events').insert([...byOrigin].map(([runId, jobIds]) => ({
          run_id: runId, user_id: notice.scope.userId, organization_id: notice.scope.organizationId, kind: COWORK_RESEARCH_NOTICE_EVENT,
          payload: { jobIds, requestId, parentRunId: notice.parent.id, message },
        })));
        if (marking.error) continue;
        if (await admitNotice(client, notice.scope, notice.parent, requestId, message)) notified++;
      } catch {
        // Access revoked or a read failed: the next minute tries again with whatever is still pending.
      }
    }
    return { notified };
  } catch {
    return { notified: 0 };
  }
}

/** Marked notices whose turn never got admitted, admitted now while their place is still the end of the conversation. */
async function recoverNotices(client: Client, origins: Map<string, Job[]>, markers: Marker[]) {
  const candidates = markers.filter(marker => typeof marker.payload?.requestId === 'string' && typeof marker.payload?.parentRunId === 'string'
    && typeof marker.payload?.message === 'string');
  if (!candidates.length) return 0;
  const requestIds = [...new Set(candidates.map(marker => String(marker.payload!.requestId)))];
  const existing = await client.from('cowork_runs').select('request_id').in('request_id', requestIds);
  if (existing.error) return 0;
  const admitted = new Set(((existing.data || []) as Array<{ request_id: string }>).map(row => row.request_id));
  let recovered = 0;
  for (const marker of candidates) {
    const requestId = String(marker.payload!.requestId);
    const scope = origins.get(marker.run_id)?.[0]?.scope;
    if (admitted.has(requestId) || !scope) continue;
    try {
      await requireCoworkWorkerAccess(client, scope);
      const parent = await coworkResearchNoticeParent(client, scope, marker.run_id);
      if (!parent || parent.id !== marker.payload!.parentRunId) continue;
      if (await admitNotice(client, scope, parent, requestId, String(marker.payload!.message))) { admitted.add(requestId); recovered++; }
    } catch {
      // The next minute tries again.
    }
  }
  return recovered;
}

export type CoworkResearchProgressItem = { leadId: string; name: string | null; company: string | null; status: string };

/**
 * The research this conversation started in the last day, for its live card («Investigando 2 · 1 lista»). runId is the
 * newest turn the person sees; its earlier turns are read up the conversation.
 */
export async function readCoworkResearchProgress(client: Client, scope: Scope, runId: string, now = new Date()): Promise<CoworkResearchProgressItem[]> {
  const runIds = new Set<string>();
  let cursor: string | null = runId;
  for (let step = 0; step < MAX_STEPS && cursor && !runIds.has(cursor); step++) {
    const run = await readRun(client, scope, cursor);
    if (!run) break;
    runIds.add(run.id);
    cursor = run.parent_run_id;
  }
  if (!runIds.size) return [];
  const { data, error } = await client.from('lead_research_jobs').select('status,created_at,request_idempotency_key')
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).like('request_idempotency_key', 'cowork:%')
    .gte('created_at', new Date(now.getTime() - LOOKBACK_MS).toISOString()).order('created_at', { ascending: true }).limit(300);
  if (error) throw new Error('No se pudo leer el avance de las investigaciones.');
  const latest = new Map<string, string>();
  for (const row of (data || []) as Array<{ status: string; request_idempotency_key: string }>) {
    const key = coworkResearchKey(row.request_idempotency_key);
    if (key && runIds.has(key.runId)) latest.set(key.leadId, String(row.status || ''));
  }
  if (!latest.size) return [];
  const names = await people(client, scope, [...latest.keys()]);
  return [...latest].map(([leadId, status]) => ({ leadId, status, name: names.get(leadId)?.name || null, company: names.get(leadId)?.company || null }));
}
