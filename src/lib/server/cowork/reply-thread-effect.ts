import { createHash } from 'node:crypto';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { coworkReplyRefusal, coworkReplyText, coworkReplyThread, type ThreadRow } from '@/lib/cowork/reply-thread';
import { COWORK_REPLY_BODY_MAX, coworkReplyBody, coworkReplySubject, coworkReplyThreadSchema } from '@/lib/cowork/reply-proposal';
import { createLegacyReadyEmailDraftV1, createMessagingSendMetadataV1 } from '@/lib/messaging-contracts';
import { prepareOutboundEmail, validateOutboundEmail } from '@/lib/email-outbound';
import { readSendSignature } from '@/lib/server/email-signature';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';
import { encryptStoredToken } from '@/lib/server/token-crypto';
import { getEffectiveDailyQuotaLimits, reserveOutboundContactQuota } from '@/lib/server/daily-quota-store';
import { dispatchOutboundMessage, OutboundPreProviderDeferredError } from '@/lib/server/outbound-dispatch';
import { ensureMessagingDraftV1 } from '@/lib/server/messaging-drafts';
import { resolveContactedReplyTarget, ReplyTargetError } from '@/lib/server/reply-target';
import { requireCoworkWorkerAccess } from './access';
import { getCoworkRun } from './runs';
import { COWORK_THREAD_COLUMNS, coworkReplyThreadEnabled } from './thread-read';
import { coworkEmailReviewMode, loadCoworkEmailReviewSeller, reviewCoworkEmail } from './email-review';

/**
 * Sending a reply inside the conversation of someone who wrote («responder dentro del hilo»), behind COWORK_REPLY_THREAD_ENABLED and the
 * reply_thread migration. Staging checks the conversation and keeps the exact text in cowork_reply_proposals, pinned by a hash in the
 * proposal target. The approval card shows that row; the approved effect sends exactly that text in the thread of that conversation, after
 * the same protections a reply sent from Contactados has (nobody is waiting on another answer, the person did not unsubscribe, the domain
 * is not blocked, the language rules, the daily quota) and the ones every Cowork send has. It never retries by itself.
 */

type Scope = { userId: string; organizationId: string };

const TARGET = /^replythread:([a-f0-9]{64})$/;

export function parseCoworkReplyThreadTarget(targetId: string) {
  const match = TARGET.exec(String(targetId || ''));
  if (!match) throw new Error('La propuesta de respuesta no es válida.');
  return { hash: match[1] };
}

export function hashCoworkReplyThread(runId: string, contactedId: string, to: string, subject: string, body: string) {
  return createHash('sha256').update(JSON.stringify(['cowork|reply-thread', runId, contactedId, to.trim().toLowerCase(), subject, body])).digest('hex');
}

/** Sent as it goes out, so one dispatch receipt stands for one approved reply: a retry finds it and sends nothing again. */
export const coworkReplyIdempotencyKey = (hash: string) => `cowork-reply-${hash.slice(0, 48)}`;

const toOneClickUnsubscribeUrl = (value: string) => {
  const parsed = new URL(value);
  parsed.pathname = '/api/tracking/unsubscribe';
  return parsed.toString();
};

async function ownConversation(client: ReturnType<typeof getSupabaseAdminClient>, scope: Scope, contactedId: string) {
  const { data, error } = await client.from('contacted_leads').select(COWORK_THREAD_COLUMNS)
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('id', contactedId).maybeSingle();
  if (error) throw new Error('No se pudo verificar la conversación.');
  if (!data) throw new Error('Esa conversación no es tuya o ya no existe: solo se responde a tus envíos.');
  return data as unknown as ThreadRow;
}

/** Why a conversation takes no reply, in the words the person reads; null when someone is waiting on one and it can go in the thread. */
const whyNotReplyable = (row: ThreadRow, now = Date.now()) => coworkReplyRefusal(coworkReplyThread(row, now));

/**
 * Stage the reply to propose: the conversation must be the person's own and take a reply, the recipient is the person of that conversation
 * and the subject and body are written as they will be sent. Nothing is sent here. Every refusal says why, so the model can tell the person.
 */
export async function stageCoworkReplyThread(scope: Scope, runId: string, input: unknown) {
  const request = coworkReplyThreadSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const state = await client.from('cowork_runs').select('status').eq('id', runId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (state.error || !state.data || (state.data.status !== 'running' && state.data.status !== 'waiting_approval')) {
    throw new Error('El trabajo ya no admite propuestas.');
  }
  const row = await ownConversation(client, scope, request.contactedId);
  const refusal = whyNotReplyable(row);
  if (refusal) throw new Error(refusal);
  const to = String(row.email || '').trim().toLowerCase();
  if (await isEmailSuppressedForScope(to, scope).catch(() => true)) throw new Error('Esa persona se dio de baja o no se pudo verificar: no se le escribe.');
  const subject = coworkReplySubject(request.subject);
  const body = coworkReplyBody(request.body);
  if (!body) throw new Error('La respuesta no tiene texto.');
  if (body.length > COWORK_REPLY_BODY_MAX) throw new Error(`La respuesta es demasiado larga (hasta ${COWORK_REPLY_BODY_MAX} caracteres).`);
  const hash = hashCoworkReplyThread(runId, request.contactedId, to, subject, body);
  const staged = await client.from('cowork_reply_proposals').upsert({
    run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
    contacted_id: request.contactedId, to_email: to, subject, body, patch_hash: hash,
  }, { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar la respuesta.');
  if (!staged.data) {
    const existing = await client.from('cowork_reply_proposals').select('patch_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.patch_hash !== hash) throw new Error('Este trabajo ya tiene otra respuesta propuesta.');
  }
  const who = [String(row.name || '').trim(), String(row.company || '').trim() ? `(${String(row.company).trim()})` : ''].filter(Boolean).join(' ') || to;
  return { hash, label: `Responder a ${who} en su hilo`.slice(0, 280), to, subject, body };
}

/** What the approval card shows: to whom, what they wrote, and the exact reply that would go out, with whether it still can. */
export async function readCoworkReplyThreadPreview(auth: AuthContext, runId: string, targetId: string) {
  const client = getSupabaseAdminClient();
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const row = await client.from('cowork_reply_proposals').select('contacted_id,to_email,subject,body,patch_hash').eq('run_id', runId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) return null;
  const contactedId = String(row.data.contacted_id);
  const to = String(row.data.to_email);
  const subject = String(row.data.subject);
  const body = String(row.data.body);
  const matches = `replythread:${String(row.data.patch_hash)}` === String(targetId || '')
    && hashCoworkReplyThread(runId, contactedId, to, subject, body) === String(row.data.patch_hash);
  let conversation: ThreadRow | null = null;
  try { conversation = await ownConversation(client, scope, contactedId); } catch { conversation = null; }
  const refusal = conversation ? whyNotReplyable(conversation) : 'Esa conversación ya no está disponible.';
  const theirs = conversation?.replied_at
    ? coworkReplyText(conversation.last_reply_text || conversation.reply_preview || conversation.reply_snippet, 400) : null;
  // A read of the exact reply next to what they wrote and the offer (COWORK_EMAIL_REVIEW); it advises and never blocks, and any failure is no review.
  const review = matches && !refusal && coworkEmailReviewMode() !== 'off'
    ? await reviewCoworkEmail({
      seller: await loadCoworkEmailReviewSeller(client, scope),
      conversation: theirs ? { with: conversation?.name ? String(conversation.name) : null, theirLastMessage: theirs.text, ourEarlierSubject: conversation?.subject ? String(conversation.subject) : null } : null,
      draft: { subject, body },
    }).catch(() => null) : null;
  return {
    to, name: conversation?.name ? String(conversation.name) : null, company: conversation?.company ? String(conversation.company) : null,
    subject, body, matches,
    theirs: theirs ? { text: theirs.text, complete: theirs.complete } : null,
    review,
    // Shown on the card before approving, not only on a failed send: what changed since the proposal.
    unavailable: refusal,
  };
}

/**
 * Send the approved reply in the conversation's thread. The staged text is checked against the approved target, the conversation is read again
 * (nobody may have answered meanwhile, the person may have unsubscribed) and every guard of a Cowork send runs before the provider. The flag is
 * also the switch that stops a reply already approved.
 */
export async function executeCoworkReplyThread(auth: AuthContext, runId: string, targetId: string) {
  if (!coworkReplyThreadEnabled()) throw new Error('Responder dentro del hilo está desactivado por ahora: no se envió nada.');
  const target = parseCoworkReplyThreadTarget(targetId);
  const userId = auth.user.id;
  const organizationId = auth.organizationId;
  const scope = { userId, organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La respuesta aprobada ya no está disponible en este trabajo.');
  }
  const assertApprovedExecution = async () => {
    await requireCoworkWorkerAccess(client, scope);
    const proposal = await client.from('cowork_effect_proposals').select('status,kind,target_id')
      .eq('run_id', runId).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
    const run = await client.from('cowork_runs').select('status')
      .eq('id', runId).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
    if (proposal.error || run.error || proposal.data?.status !== 'executing'
      || proposal.data.kind !== 'reply_thread' || proposal.data.target_id !== targetId
      || run.data?.status !== 'waiting_approval') {
      throw new Error('La autorización de envío ya no está vigente.');
    }
  };
  await assertApprovedExecution();
  const staged = await client.from('cowork_reply_proposals').select('contacted_id,to_email,subject,body,patch_hash')
    .eq('run_id', runId).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
  if (staged.error || !staged.data) throw new Error('La respuesta aprobada ya no está disponible.');
  const contactedId = String(staged.data.contacted_id);
  const to = String(staged.data.to_email);
  const subject = String(staged.data.subject);
  const body = String(staged.data.body);
  if (staged.data.patch_hash !== target.hash || hashCoworkReplyThread(runId, contactedId, to, subject, body) !== target.hash) {
    throw new Error('La respuesta cambió desde tu revisión. Pide una nueva revisión.');
  }
  // The conversation as it is now: still the person's, still waiting on an answer, still at the same address.
  const row = await ownConversation(client, scope, contactedId);
  const refusal = whyNotReplyable(row);
  if (refusal) throw new Error(`${refusal} No se envió la respuesta.`);
  if (String(row.email || '').trim().toLowerCase() !== to) throw new Error('El destinatario de la conversación cambió desde tu revisión. No se envió la respuesta.');
  try {
    if (await isEmailSuppressedForScope(to, scope)) throw new Error('El destinatario se dio de baja. No se envió la respuesta.');
  } catch (error) {
    if (error instanceof Error && error.message === 'El destinatario se dio de baja. No se envió la respuesta.') throw error;
    throw new Error('No se pudo verificar el estado del destinatario. No se envió la respuesta.');
  }
  const domain = to.split('@')[1]?.trim().toLowerCase() || '';
  if (domain) {
    const { data: blocked, error } = await client.from('excluded_domains').select('domain').eq('organization_id', organizationId);
    if (error) throw new Error('No se pudo verificar la política de dominios. No se envió la respuesta.');
    if ((blocked || []).some((entry: { domain?: string }) => String(entry.domain || '').trim().toLowerCase().replace(/^@/, '') === domain)) {
      throw new Error(`El dominio ${domain} está bloqueado. No se envió la respuesta.`);
    }
  }
  // The language rules are checked on the exact text that goes out; skipping the tool would skip the control.
  try {
    const { readCoworkMessageContext } = await import('./message-context');
    const { checkMessageTerms } = await import('@/lib/cowork/message-checks');
    const messaging = await readCoworkMessageContext(client, scope);
    const context = messaging.context as { prohibitedTerms?: string[]; requiredTerms?: string[] } | null;
    const gate = checkMessageTerms(`${subject}\n${body}`, { prohibitedTerms: context?.prohibitedTerms || [], requiredTerms: context?.requiredTerms || [] });
    if (gate.verdict === 'blocked' || gate.verdict === 'fail') {
      const detail = gate.prohibitedFound.length ? `Término prohibido: ${gate.prohibitedFound.join(', ')}` : `Falta término obligatorio: ${gate.requiredMissing.join(', ')}`;
      throw new Error(`La respuesta incumple las reglas de lenguaje aprobadas (${detail}). No se envió.`);
    }
  } catch (error) {
    if (error instanceof Error && /incumple las reglas de lenguaje/.test(error.message)) throw error;
    throw new Error('No se pudo verificar las reglas de lenguaje. No se envió la respuesta.');
  }
  const unsubscribeUrl = generateUnsubscribeLink(to, userId, organizationId);
  // The signature of the mailbox that wrote the original, as in any other send.
  const signature = await readSendSignature(client, userId, String(row.provider || ''));
  const prepared = prepareOutboundEmail({ text: body, unsubscribeUrl, signature });
  const check = validateOutboundEmail({ to, subject, ...prepared, requireUnsubscribe: true, unsubscribeUrl });
  if (!check.ok) throw new Error(`La respuesta no pasó la validación: ${check.errors.join(' ')}`.slice(0, 280));
  // The thread belongs to the mailbox that sent the original.
  const dispatchProvider = String(row.provider).toLowerCase() === 'outlook' ? 'outlook' as const : 'gmail' as const;
  const provider = dispatchProvider === 'gmail' ? 'google' as const : 'outlook' as const;
  const existingToken = await tokenService.getToken(client, userId, provider);
  if (!existingToken?.refresh_token) throw new Error('Reconecta tu cuenta de correo para continuar. No se envió la respuesta.');
  const idempotencyKey = coworkReplyIdempotencyKey(target.hash);
  const requestedAt = new Date().toISOString();
  const draft = createLegacyReadyEmailDraftV1({
    organizationId, userId, idempotencyKey, requestedAt, researchSnapshotId: null, leadRef: `contacted:${contactedId}`,
    to, subject, text: body, html: null,
  });
  await ensureMessagingDraftV1(draft);
  const metadata = createMessagingSendMetadataV1(draft, { idempotencyKey, provider: dispatchProvider, requestedAt });
  const result = await dispatchOutboundMessage({ draft, metadata, provider: {
    async send({ dispatchId }) {
      const admin = getSupabaseAdminClient();
      await assertApprovedExecution();
      // Resolved only after the durable claim: a replay never selects a parent or sends again.
      let replyTarget;
      try {
        replyTarget = await resolveContactedReplyTarget(admin, { contactedId, organizationId, userId, provider: dispatchProvider, recipient: to });
      } catch (error) {
        if (error instanceof ReplyTargetError) return { outcome: 'rejected' as const, code: 'reply_target_unavailable', message: error.message, response: { providerInvoked: false } };
        throw new OutboundPreProviderDeferredError('No se pudo verificar el hilo original. No se invocó al proveedor.', { code: 'reply_history_unavailable', cause: error });
      }
      const token = await tokenService.getToken(admin, userId, provider);
      if (!token?.refresh_token) {
        throw new OutboundPreProviderDeferredError('Reconecta tu cuenta de correo para continuar.', { code: 'provider_connection_unavailable', retryAfterMs: 3600000 });
      }
      let accessToken: string;
      try {
        if (provider === 'google') {
          const refreshed = await refreshGoogleToken(token.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!);
          accessToken = refreshed.access_token;
        } else {
          const refreshed = await refreshMicrosoftToken(token.refresh_token, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!);
          accessToken = refreshed.access_token;
          if (refreshed.refresh_token) {
            const saved = await admin.from('provider_tokens').update({ refresh_token: encryptStoredToken(refreshed.refresh_token), updated_at: new Date().toISOString() }).eq('user_id', userId).eq('provider', provider);
            if (saved.error) throw saved.error;
          }
        }
      } catch (cause) {
        throw new OutboundPreProviderDeferredError('Reconecta tu cuenta de correo para continuar.', { code: 'provider_connection_unavailable', cause, retryAfterMs: 3600000 });
      }
      let quota;
      try {
        const limits = await getEffectiveDailyQuotaLimits(scope);
        quota = await reserveOutboundContactQuota({ ...scope, dispatchId, limit: limits.contact });
      } catch (cause) {
        throw new OutboundPreProviderDeferredError('No se pudo reservar la cuota.', { code: 'quota_reservation_unavailable', cause });
      }
      if (!quota.allowed) return { outcome: 'deferred' as const, code: 'daily_quota_exceeded', message: 'Se alcanzó el límite diario de contactos.', retryAfterMs: 3600000 };
      // Checked once more, immediately before the provider: approval, the person's unsubscribe and whether someone answered meanwhile.
      await assertApprovedExecution();
      const latest = await ownConversation(admin, scope, contactedId);
      const nowRefusal = whyNotReplyable(latest);
      if (nowRefusal) return { outcome: 'rejected' as const, code: 'conversation_changed', message: nowRefusal, response: { providerInvoked: false } };
      if (await isEmailSuppressedForScope(to, scope)) {
        return { outcome: 'rejected' as const, code: 'recipient_suppressed', message: 'El destinatario se dio de baja.', response: { providerInvoked: false } };
      }
      const options = { textBody: prepared.text, unsubscribeUrl, oneClickUnsubscribeUrl: toOneClickUnsubscribeUrl(unsubscribeUrl), idempotencyKey, replyTarget };
      const receipt = provider === 'google'
        ? await sendGmail(accessToken, to, subject, prepared.html, options)
        : await sendOutlook(accessToken, to, subject, prepared.html, options);
      const response = (receipt || {}) as Record<string, unknown>;
      const providerMessageId = String(response.id || response.messageId || response.internetMessageId || '');
      if (!providerMessageId) throw new Error('El proveedor no confirmó el envío.');
      return { outcome: 'accepted' as const, providerMessageId, response };
    },
  } });
  const dispatch = result.dispatch;
  if (dispatch.status === 'sent') {
    // The conversation now has an answer of ours: the day's agenda and Contactados stop listing it as waiting.
    const projected = await client.from('contacted_leads').update({ conversation_outbound_at: dispatch.completedAt || new Date().toISOString(), last_update_at: new Date().toISOString() })
      .eq('id', contactedId).eq('organization_id', organizationId).eq('user_id', userId);
    if (projected.error) console.error('[cowork] reply sent but the conversation was not marked as answered', { runId });
    return {
      reply: `La respuesta salió en el hilo con el texto aprobado${row.name ? ` a ${String(row.name)}` : ''}. Quedó registrada en Contactados.`,
      result: { status: 'sent' as const, providerMessageId: dispatch.providerMessageId, contactedId },
    };
  }
  if (dispatch.status === 'deferred') {
    if (dispatch.errorCode === 'daily_quota_exceeded') throw new Error('Se alcanzó el límite diario de contactos. La respuesta quedó diferida, no duplicada.');
    throw new Error(`El envío quedó diferido: ${dispatch.errorMessage || dispatch.errorCode || 'revisa en Contactados'}.`.slice(0, 280));
  }
  if (dispatch.status === 'unknown') {
    throw new Error('No pudimos confirmar si la respuesta salió. Revisa en Contactados antes de reintentar: no se reenviará sola.');
  }
  throw new Error(`No se pudo enviar la respuesta: ${dispatch.errorMessage || dispatch.errorCode || 'error del proveedor'}.`.slice(0, 280));
}
