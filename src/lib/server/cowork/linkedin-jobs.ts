import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import {
  LINKEDIN_JOB_EXPIRY_DAYS, LINKEDIN_MESSAGE_MAX, LINKEDIN_WEEKLY_INVITE_LIMIT,
  classifyInviteQuota, inviteIdempotencyKey, jobExpired, messageIdempotencyKey,
  verifyLinkedinIdentity,
} from '@/lib/cowork/linkedin-bridge';
import { findCompanyReply, findNegotiationHold } from '@/lib/server/campaign-send-guards';

type Scope = { userId: string; organizationId: string };

const inviteInputSchema = z.object({ leadId: z.string().uuid() });
const messageInputSchema = z.object({
  leadId: z.string().uuid(),
  message: z.string().trim().min(1).max(LINKEDIN_MESSAGE_MAX),
});

function hashJob(runId: string, kind: string, leadId: string, idempotencyKey: string, messageHash: string | null) {
  return createHash('sha256')
    .update(`cowork|linkedin-job|${runId}|${kind}|${leadId}|${idempotencyKey}|${messageHash || ''}`).digest('hex');
}

export function parseCoworkLinkedinJobTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 2 || parts[0] !== 'linkedinjob' || !/^[a-f0-9]{64}$/.test(parts[1])) {
    throw new Error('La propuesta de LinkedIn no es válida.');
  }
  return { hash: parts[1] };
}

type LeadRow = { id: string; name: string | null; email: string | null; title: string | null;
  company: string | null; linkedin_url: string | null };

async function loadOwnLead(client: ReturnType<typeof getSupabaseAdminClient>, scope: Scope, leadId: string): Promise<LeadRow> {
  const { data, error } = await client.from('leads')
    .select('id,name,email,title,company,linkedin_url')
    .eq('organization_id', scope.organizationId).eq('id', leadId).maybeSingle();
  if (error) throw new Error('No se pudo leer el contacto.');
  if (!data) throw new Error('El contacto no está disponible en tu organización.');
  return data as LeadRow;
}

async function assertRunOpen(client: ReturnType<typeof getSupabaseAdminClient>, scope: Scope, runId: string) {
  const state = await client.from('cowork_runs').select('status').eq('id', runId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (state.error || !state.data || (state.data.status !== 'running' && state.data.status !== 'waiting_approval')) {
    throw new Error('El trabajo ya no admite propuestas.');
  }
}

async function inviteQuota(client: ReturnType<typeof getSupabaseAdminClient>, scope: Scope) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const pending = await client.from('cowork_linkedin_jobs').select('id', { count: 'exact', head: true })
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .eq('kind', 'invite').in('status', ['queued', 'claimed']);
  if (pending.error) throw new Error('No se pudo comprobar el cupo de invitaciones.');
  const sent = await client.from('cowork_linkedin_jobs').select('id', { count: 'exact', head: true })
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .eq('kind', 'invite').eq('status', 'confirmed').gte('created_at', since);
  if (sent.error) throw new Error('No se pudo comprobar el cupo de invitaciones.');
  return classifyInviteQuota(Number(pending.count || 0), Number(sent.count || 0), LINKEDIN_WEEKLY_INVITE_LIMIT);
}

async function existingLiveJob(client: ReturnType<typeof getSupabaseAdminClient>, scope: Scope, idempotencyKey: string) {
  const { data, error } = await client.from('cowork_linkedin_jobs')
    .select('id,status,created_at').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .eq('idempotency_key', idempotencyKey).not('status', 'in', '(failed,expired)').limit(1);
  if (error) throw new Error('No se pudo comprobar trabajos previos.');
  return (data || [])[0] as { id: string; status: string; created_at: string } | undefined;
}

async function crmStages(client: ReturnType<typeof getSupabaseAdminClient>, scope: Scope, leadId: string): Promise<string[]> {
  const { data, error } = await client.from('unified_crm_data').select('stage')
    .eq('organization_id', scope.organizationId).in('id', [`lead_saved|${leadId}`, `lead_enriched|${leadId}`]).limit(10);
  if (error) throw new Error('No se pudo comprobar la etapa comercial.');
  return ((data || []) as Array<{ stage?: unknown }>).map(row => row.stage).filter((stage): stage is string => typeof stage === 'string');
}

/** Programa una invitacion sin nota: staging con identidad y cupo. La
 * ejecucion crea el trabajo en cola; solo tu extension, en tu navegador y
 * ante el perfil verificado, puede ejecutarlo y confirmarlo. */
export async function stageCoworkLinkedinInvite(scope: Scope, runId: string, input: unknown) {
  const parsed = inviteInputSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  await assertRunOpen(client, scope, runId);
  const lead = await loadOwnLead(client, scope, parsed.leadId);
  const canonical = normalizeLinkedinProfileUrl(lead.linkedin_url);
  if (!canonical) throw new Error('El contacto no tiene una URL de perfil LinkedIn válida.');
  const identity = verifyLinkedinIdentity({ url: canonical, name: lead.name },
    { kind: 'saved_lead', url: lead.linkedin_url, name: lead.name });
  const quota = await inviteQuota(client, scope);
  if (!quota.allowed) throw new Error(quota.reason);
  const key = inviteIdempotencyKey(scope.organizationId, scope.userId, canonical);
  const duplicate = await existingLiveJob(client, scope, key);
  if (duplicate) throw new Error(`Ya hay una invitación registrada para este perfil (estado: ${duplicate.status}). No se duplica.`);
  const hash = hashJob(runId, 'invite', lead.id, key, null);
  const staged = await client.from('cowork_linkedin_job_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      kind: 'invite', lead_id: lead.id, canonical_url: canonical,
      idempotency_key: key, message_hash: null, proposal_hash: hash },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar la invitación.');
  if (!staged.data) {
    const existing = await client.from('cowork_linkedin_job_proposals').select('proposal_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.proposal_hash !== hash) {
      throw new Error('Este trabajo ya tiene otra propuesta de LinkedIn.');
    }
  }
  return { hash, canonicalUrl: canonical, nameCheck: identity.nameCheck, quota: quota.reason };
}

/** Programa un mensaje LinkedIn con frenos de cuenta y duplicado. Igual que
 * la invitacion: la extension lo ejecuta ante el perfil verificado. */
export async function stageCoworkLinkedinMessage(scope: Scope, runId: string, input: unknown) {
  const parsed = messageInputSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  await assertRunOpen(client, scope, runId);
  const lead = await loadOwnLead(client, scope, parsed.leadId);
  const canonical = normalizeLinkedinProfileUrl(lead.linkedin_url);
  if (!canonical) throw new Error('El contacto no tiene una URL de perfil LinkedIn válida.');
  const identity = verifyLinkedinIdentity({ url: canonical, name: lead.name },
    { kind: 'saved_lead', url: lead.linkedin_url, name: lead.name });
  const key = messageIdempotencyKey(scope.organizationId, scope.userId, canonical, parsed.message);
  const duplicate = await existingLiveJob(client, scope, key);
  if (duplicate) throw new Error(`Este mensaje ya tiene un trabajo registrado (estado: ${duplicate.status}). No se duplica.`);
  // Un mensaje por perfil y dia como tope del programador.
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const today = await client.from('cowork_linkedin_jobs').select('id', { count: 'exact', head: true })
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .eq('canonical_url', canonical).in('status', ['queued', 'claimed', 'confirmed']).gte('created_at', dayStart);
  if (today.error) throw new Error('No se pudo comprobar mensajes del día.');
  if (Number(today.count || 0) > 0) throw new Error('Ya hay una acción para este perfil hoy. Vuelve mañana.');
  if (lead.email) {
    const reply = await findCompanyReply(client as never, scope, lead.email, lead.company);
    if (reply.stopped) throw new Error(`Esta empresa ya respondió (${reply.email}). El mensaje queda retenido.`);
  }
  const stages = await crmStages(client, scope, lead.id);
  if (stages.some(stage => stage === 'negotiation' || stage === 'meeting')) {
    throw new Error(`La cuenta está en etapa ${stages.join(', ')}. Mensaje retenido.`);
  }
  const messageHash = createHash('sha256').update(parsed.message).digest('hex');
  const hash = hashJob(runId, 'message', lead.id, key, messageHash);
  const staged = await client.from('cowork_linkedin_job_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      kind: 'message', lead_id: lead.id, canonical_url: canonical,
      idempotency_key: key, message: parsed.message, message_hash: messageHash, proposal_hash: hash },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar el mensaje.');
  if (!staged.data) {
    const existing = await client.from('cowork_linkedin_job_proposals').select('proposal_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.proposal_hash !== hash) {
      throw new Error('Este trabajo ya tiene otra propuesta de LinkedIn.');
    }
  }
  return { hash, canonicalUrl: canonical, nameCheck: identity.nameCheck,
    emailCheck: lead.email ? 'company_reply_checked' : 'skipped_no_email', stages };
}

async function executeJob(auth: AuthContext, runId: string, targetId: string, kind: 'invite' | 'message', message: string | null) {
  const target = parseCoworkLinkedinJobTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const staged = await client.from('cowork_linkedin_job_proposals')
    .select('kind,lead_id,canonical_url,idempotency_key,message,message_hash,proposal_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (staged.error || !staged.data) throw new Error('La propuesta aprobada ya no está disponible.');
  const proposal = staged.data as { kind: string; lead_id: string; canonical_url: string;
    idempotency_key: string; message: string | null; message_hash: string | null; proposal_hash: string };
  if (proposal.kind !== kind || proposal.proposal_hash !== target.hash) {
    throw new Error('La propuesta cambió desde tu revisión. Pide una nueva revisión.');
  }
  const lead = await loadOwnLead(client, scope, proposal.lead_id);
  const canonical = normalizeLinkedinProfileUrl(lead.linkedin_url);
  if (!canonical || canonical !== proposal.canonical_url) {
    throw new Error('El perfil del contacto cambió desde tu revisión. Vuelve a verificarlo.');
  }
  verifyLinkedinIdentity({ url: canonical, name: lead.name },
    { kind: 'saved_lead', url: lead.linkedin_url, name: lead.name });
  if (kind === 'invite') {
    const quota = await inviteQuota(client, scope);
    if (!quota.allowed) throw new Error(quota.reason);
  } else {
    if (lead.email) {
      const reply = await findCompanyReply(client as never, scope, lead.email, lead.company);
      if (reply.stopped) throw new Error(`Esta empresa ya respondió (${reply.email}). El mensaje queda retenido.`);
    }
    const stages = await crmStages(client, scope, lead.id);
    if (stages.some(stage => stage === 'negotiation' || stage === 'meeting')) {
      throw new Error('La cuenta entró en negociación. Mensaje retenido.');
    }
  }
  if (kind === 'message') {
    if (!proposal.message || createHash('sha256').update(proposal.message).digest('hex') !== proposal.message_hash) {
      throw new Error('El mensaje aprobado cambió. Pide una nueva revisión.');
    }
  }
  const recomputed = hashJob(runId, kind, lead.id, proposal.idempotency_key, proposal.message_hash);
  if (recomputed !== target.hash) throw new Error('La propuesta cambió desde tu revisión. Pide una nueva revisión.');
  const finalMessage = kind === 'message' ? proposal.message : null;
  const saved = await client.from('cowork_linkedin_jobs').upsert(
    { organization_id: scope.organizationId, user_id: scope.userId, run_id: runId, kind,
      canonical_url: canonical, profile_url: lead.linkedin_url, display_name: String(lead.name || '').slice(0, 300),
      message: finalMessage, status: 'queued', idempotency_key: proposal.idempotency_key,
      claim_token: randomUUID(), updated_at: new Date().toISOString() },
    { onConflict: 'organization_id,user_id,idempotency_key', ignoreDuplicates: true })
    .select('id,status').maybeSingle();
  if ((saved.error && String((saved.error as { code?: string }).code) !== '23505') || (!saved.data && saved.error)) {
    throw new Error('No se pudo encolar el trabajo de LinkedIn.');
  }
  return { reply: kind === 'invite'
    ? `Invitación en cola para ${lead.name || canonical}. Ejecútala desde la extensión ante ese perfil; vence en ${LINKEDIN_JOB_EXPIRY_DAYS} días.`
    : `Mensaje en cola para ${lead.name || canonical}. Ejecútalo desde la extensión ante ese perfil; vence en ${LINKEDIN_JOB_EXPIRY_DAYS} días.`,
    result: { jobId: saved.data?.id || null, reused: !saved.data, kind, canonicalUrl: canonical } };
}

export async function executeCoworkLinkedinInvite(auth: AuthContext, runId: string, targetId: string) {
  return executeJob(auth, runId, targetId, 'invite', null);
}

export async function executeCoworkLinkedinMessage(auth: AuthContext, runId: string, targetId: string) {
  return executeJob(auth, runId, targetId, 'message', null);
}
