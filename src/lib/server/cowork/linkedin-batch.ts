import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { listCompanyKeysSentToday } from '@/lib/server/campaign-send-guards';
import { santiagoDayBounds } from '@/lib/cowork/send-cadence';
import { inviteIdempotencyKey, messageIdempotencyKey } from '@/lib/cowork/linkedin-bridge';
import {
  COWORK_BATCH_REASON, COWORK_LINKEDIN_BATCH_EFFECT, coworkBatchCompanyKeys, coworkLinkedinBatchKindOf, coworkLinkedinBatchLabel,
  coworkLinkedinBatchLeads, coworkLinkedinBatchSummary, hashCoworkLinkedinBatch, planLinkedinBatch,
  type CoworkLinkedinBatchCandidate, type CoworkLinkedinBatchDeferred, type CoworkLinkedinBatchItem, type CoworkLinkedinBatchKind,
  type CoworkLinkedinBatchResult,
} from '@/lib/cowork/linkedin-batch';
import { requireCoworkWorkerAccess } from './access';
import { getCoworkRun } from './runs';
import { observedCoworkLeadIds } from './observed-leads';
import {
  assertLinkedinMessageAllowed, assertLinkedinMessageStillAllowed, assertRunOpen, existingLiveJob, inviteQuota, linkedinProfileOf,
  loadOwnLead, queueLinkedinJob, type LeadRow, type Scope,
} from './linkedin-jobs';

/**
 * Invitations or messages for several people on LinkedIn with one approval, behind COWORK_LINKEDIN_BATCH_ENABLED and the
 * cowork_batch_proposals migration. Staging checks every person like a single action would (the same brakes), leaves the ones that
 * cannot go today with the reason (one company a day, the weekly quota, a stopped account) and keeps the list in
 * cowork_batch_proposals, pinned by a hash in the proposal target. The card lets the person take people off before approving;
 * the approved effect queues a job for each one left, checking them again, and reports person by person. Nothing is sent here:
 * the extension runs each job in the person's browser.
 */

export const coworkLinkedinBatchEnabled = () => process.env.COWORK_LINKEDIN_BATCH_ENABLED === 'true';

const TARGET = /^linkedinbatch:([a-f0-9]{64})$/;

export function parseCoworkLinkedinBatchTarget(targetId: string) {
  const match = TARGET.exec(String(targetId || ''));
  if (!match) throw new Error('La propuesta de lote no es válida.');
  return { hash: match[1] };
}

/** A refusal the person can read as it is: the route answers 409 with its message. Anything else stays generic. */
export class CoworkBatchRefusal extends Error {}

type Client = ReturnType<typeof getSupabaseAdminClient>;
type Staged = { kind: string; items: CoworkLinkedinBatchItem[]; deferred?: CoworkLinkedinBatchDeferred[]; excluded: string[]; patch_hash: string };

const reasonOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback).slice(0, 240);

/** The companies with something out today, by email or by LinkedIn: a batch planned for today leaves them for another day. The jobs of
 * `exceptRunId` (the batch that is running) are not counted against itself, so running it again finds its own jobs instead of skipping them. */
async function companiesTouchedToday(client: Client, scope: Scope, dayStart: string, exceptRunId?: string) {
  const keys = await listCompanyKeysSentToday(client as never, scope, dayStart);
  const jobs = await client.from('cowork_linkedin_jobs').select('company_key,run_id').eq('organization_id', scope.organizationId)
    .not('company_key', 'is', null).in('status', ['queued', 'claimed', 'confirmed', 'uncertain']).gte('created_at', dayStart).limit(500);
  if (jobs.error) throw new Error('No se pudo comprobar las acciones de LinkedIn de hoy.');
  if ((jobs.data || []).length >= 500) throw new Error('Historial de acciones de LinkedIn incompleto.');
  for (const row of (jobs.data || []) as Array<{ company_key?: string | null; run_id?: string | null }>) {
    if (row.company_key && !(exceptRunId && row.run_id === exceptRunId)) keys.add(row.company_key);
  }
  return keys;
}

/**
 * Stage the batch to propose: every person must be a saved contact this thread already looked at; the guards of a single action run
 * for each one; who goes today and who waits is planned (planLinkedinBatch) and the list is kept as the card will show it.
 * Nothing is queued here. Every refusal says why, so the model can tell the person.
 */
export async function stageCoworkLinkedinBatch(scope: Scope, runId: string, originRunId: string, kind: CoworkLinkedinBatchKind, input: unknown) {
  const wanted = coworkLinkedinBatchLeads(kind, input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  await assertRunOpen(client, scope, runId);
  const events = await client.from('cowork_run_events').select('kind,payload')
    .in('run_id', [...new Set([runId, originRunId])]).eq('user_id', scope.userId).eq('organization_id', scope.organizationId);
  if (events.error) throw new Error('No se pudo comprobar lo consultado en este trabajo.');
  const seen = observedCoworkLeadIds((events.data || []) as Array<{ kind: string; payload: unknown }>);
  if (wanted.some(person => !seen.has(person.leadId))) throw new Error('Todas las personas del lote deben haberse consultado antes en esta conversación.');
  const rows = await client.from('leads').select('id,name,email,title,company,linkedin_url')
    .eq('organization_id', scope.organizationId).in('id', wanted.map(person => person.leadId));
  if (rows.error) throw new Error('No se pudo leer a las personas del lote.');
  const byId = new Map(((rows.data || []) as LeadRow[]).map(lead => [lead.id, lead]));
  if (wanted.some(person => !byId.has(person.leadId))) throw new Error('Todas las personas del lote deben ser contactos guardados de tu organización.');
  const quota = kind === 'invite' ? await inviteQuota(client, scope) : null;
  const quotaLeft = quota ? Math.max(0, quota.limit - quota.pending - quota.sent7d) : null;
  const touched = await companiesTouchedToday(client, scope, santiagoDayBounds(new Date()).start);
  const candidates: CoworkLinkedinBatchCandidate[] = [];
  for (const { leadId, message } of wanted) {
    const lead = byId.get(leadId)!;
    let blocked: string | null = null;
    let canonical = '';
    try {
      canonical = linkedinProfileOf(lead).canonical;
      if (kind === 'invite') {
        const duplicate = await existingLiveJob(client, scope, inviteIdempotencyKey(scope.organizationId, scope.userId, canonical));
        if (duplicate) throw new Error(`Ya hay una invitación registrada para este perfil (estado: ${duplicate.status}). No se duplica.`);
      } else {
        await assertLinkedinMessageAllowed(client, scope, lead, canonical, messageIdempotencyKey(scope.organizationId, scope.userId, canonical, message!));
      }
    } catch (error) { blocked = reasonOf(error, 'No se pudo comprobar a esta persona.'); }
    candidates.push({ id: lead.id, name: lead.name, company: lead.company, title: lead.title, canonicalUrl: canonical,
      ...(message ? { message } : {}), keys: coworkBatchCompanyKeys(lead), blocked });
  }
  const plan = planLinkedinBatch(kind, candidates, { quotaLeft, companiesToday: touched });
  if (!plan.items.length) {
    const reasons = [...new Set(plan.deferred.map(person => person.reason))].slice(0, 3).join(' · ');
    throw new Error(`Nadie del lote puede salir hoy. ${reasons}`.slice(0, 480));
  }
  const hash = hashCoworkLinkedinBatch(runId, kind, plan.items);
  const staged = await client.from('cowork_batch_proposals').upsert({
    run_id: runId, user_id: scope.userId, organization_id: scope.organizationId, kind: COWORK_LINKEDIN_BATCH_EFFECT[kind],
    items: plan.items, deferred: plan.deferred, patch_hash: hash,
  }, { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar el lote.');
  if (!staged.data) {
    const existing = await client.from('cowork_batch_proposals').select('patch_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.patch_hash !== hash) throw new Error('Este trabajo ya tiene otro lote propuesto.');
  }
  return { hash, label: coworkLinkedinBatchLabel(kind, plan.items.length), count: plan.items.length, deferred: plan.deferred.length };
}

async function readStaged(client: Client, scope: Scope, runId: string) {
  const row = await client.from('cowork_batch_proposals').select('kind,items,deferred,excluded,patch_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) return null;
  return row.data as unknown as Staged;
}

/** What the approval card shows: who is in the batch with what each one gets, who waits for another day and why, who was taken off,
 * the quota, and once it ran, what happened to each person. `matches` is false when the list is not the one that was proposed. */
export async function readCoworkLinkedinBatchPreview(auth: AuthContext, runId: string, targetId: string) {
  const client = getSupabaseAdminClient();
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const staged = await readStaged(client, scope, runId);
  const kind = staged ? coworkLinkedinBatchKindOf(staged.kind) : null;
  if (!staged || !kind) return null;
  const matches = `linkedinbatch:${staged.patch_hash}` === String(targetId || '') && hashCoworkLinkedinBatch(runId, kind, staged.items) === staged.patch_hash;
  const proposal = await client.from('cowork_effect_proposals').select('status,result')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  const quota = kind === 'invite' ? await inviteQuota(client, scope).catch(() => null) : null;
  const results = (proposal.data?.result as { items?: CoworkLinkedinBatchResult[] } | null)?.items;
  return {
    kind, items: staged.items, deferred: staged.deferred || [], excluded: staged.excluded || [], matches,
    // Only a proposal that still awaits the decision lets people be taken off.
    open: proposal.data?.status === 'proposed',
    quota: quota ? { used: quota.pending + quota.sent7d, limit: quota.limit } : null,
    results: Array.isArray(results) ? results : null,
  };
}

/** The people the person took off the card, recorded before the approval. Only while the proposal awaits the decision (the table
 * refuses it otherwise, and an approval that arrives at the same time waits for this), and never the whole list. */
export async function setCoworkLinkedinBatchExclusions(auth: AuthContext, runId: string, excluded: unknown) {
  const ids = z.array(z.string().uuid()).max(50).parse(excluded);
  if (new Set(ids).size !== ids.length) throw new CoworkBatchRefusal('Hay personas repetidas.');
  const client = getSupabaseAdminClient();
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const staged = await readStaged(client, scope, runId);
  if (!staged) throw new CoworkBatchRefusal('La propuesta ya no está disponible.');
  const known = new Set(staged.items.map(item => item.id));
  if (ids.some(id => !known.has(id))) throw new CoworkBatchRefusal('Solo se puede quitar a personas del lote.');
  if (ids.length >= staged.items.length) throw new CoworkBatchRefusal('Quitaste a todas las personas: descarta la propuesta en vez de aprobarla.');
  const updated = await client.from('cowork_batch_proposals').update({ excluded: ids })
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).select('run_id').maybeSingle();
  if (updated.error) {
    if (String((updated.error as { code?: string }).code) === '23514') throw new CoworkBatchRefusal('Esta propuesta ya se decidió: no se puede cambiar a quién va.');
    throw new Error('No se pudo guardar a quién quitaste.');
  }
  if (!updated.data) throw new CoworkBatchRefusal('La propuesta ya no está disponible.');
  return { excluded: ids };
}

/**
 * Queue the approved batch: a job for each person left, after checking them again (the profile is the same, the company has
 * nothing out today, the quota, the company did not answer and the account is not negotiating), and the result person by person.
 * The flag is also the switch that stops a batch already approved. It queues nothing for someone who was taken off.
 */
export async function executeCoworkLinkedinBatch(auth: AuthContext, runId: string, targetId: string, effectKind: string) {
  if (!coworkLinkedinBatchEnabled()) throw new Error('Los lotes de LinkedIn están desactivados por ahora: no se encoló nada.');
  const kind = coworkLinkedinBatchKindOf(effectKind);
  if (!kind) throw new Error('La propuesta de lote no es válida.');
  const target = parseCoworkLinkedinBatchTarget(targetId);
  const userId = auth.user.id;
  const organizationId = auth.organizationId;
  const scope = { userId, organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('El lote aprobado ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const proposal = await client.from('cowork_effect_proposals').select('status,kind,target_id')
    .eq('run_id', runId).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
  if (proposal.error || proposal.data?.status !== 'executing' || proposal.data.kind !== effectKind || proposal.data.target_id !== targetId) {
    throw new Error('La autorización del lote ya no está vigente.');
  }
  const staged = await readStaged(client, scope, runId);
  if (!staged) throw new Error('El lote aprobado ya no está disponible.');
  if (staged.kind !== effectKind || staged.patch_hash !== target.hash || hashCoworkLinkedinBatch(runId, kind, staged.items) !== target.hash) {
    throw new Error('El lote cambió desde tu revisión. Pide una nueva revisión.');
  }
  const removed = new Set(staged.excluded || []);
  const touched = await companiesTouchedToday(client, scope, santiagoDayBounds(new Date()).start, runId);
  const results: CoworkLinkedinBatchResult[] = [];
  for (const item of staged.items) {
    if (removed.has(item.id)) { results.push({ id: item.id, name: item.name, status: 'removed' }); continue; }
    try {
      const lead = await loadOwnLead(client, scope, item.id);
      const { canonical } = linkedinProfileOf(lead);
      if (canonical !== item.canonicalUrl) throw new Error('El perfil del contacto cambió desde tu revisión.');
      const keys = coworkBatchCompanyKeys(lead);
      if (keys.some(key => touched.has(key))) throw new Error(COWORK_BATCH_REASON.companyToday);
      let idempotencyKey: string;
      if (kind === 'invite') {
        const quota = await inviteQuota(client, scope);
        if (!quota.allowed) throw new Error(quota.reason);
        idempotencyKey = inviteIdempotencyKey(organizationId, userId, canonical);
      } else {
        if (!item.message) throw new Error('El mensaje aprobado ya no está.');
        idempotencyKey = messageIdempotencyKey(organizationId, userId, canonical, item.message);
        await assertLinkedinMessageStillAllowed(client, scope, lead);
      }
      const queued = await queueLinkedinJob(client, scope, { runId, kind, lead, canonical, idempotencyKey, message: item.message ?? null });
      for (const key of keys) touched.add(key);
      results.push({ id: item.id, name: item.name, status: queued.reused ? 'reused' : 'queued' });
    } catch (error) {
      results.push({ id: item.id, name: item.name, status: 'skipped', reason: reasonOf(error, 'No se pudo encolar.') });
    }
  }
  const queued = results.filter(result => result.status === 'queued' || result.status === 'reused').length;
  if (!queued) {
    const reasons = [...new Set(results.flatMap(result => result.reason ? [result.reason] : []))].slice(0, 3).join(' · ');
    throw new Error(`No se encoló nada del lote. ${reasons}`.slice(0, 480));
  }
  return { reply: coworkLinkedinBatchSummary(kind, results), result: { kind, items: results, queued } };
}
