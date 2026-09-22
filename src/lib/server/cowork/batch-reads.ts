import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { nextCampaignMessage, type BulkCampaign, type CampaignDelivery } from '@/lib/bulk-campaigns';
import { withSentAttemptsAsDeliveries } from '@/lib/bulk-campaign-attempts';
import { findNegotiationHold } from '@/lib/server/campaign-send-guards';
import {
  classifySendRetry, companyKeysFor, companyRowMatches, describeCadence,
  planCompanyDays, santiagoDayBounds, NEGOTIATION_HOLD_STAGES,
} from '@/lib/cowork/send-cadence';

type Scope = { userId: string; organizationId: string };

const campaignIdSchema = z.string().uuid();

type TouchState = {
  draftId: string; versionId: string; dispatchId: string | null;
  index: number; touchNumber: number; subject: string; delayDays: number;
  status: string; dueAt: string | null; dueAtSantiago: string | null;
  sentAt: string | null; providerMessageId: string | null;
  error: string | null; retryAt: string | null; retryAction: string; retryReason: string;
};

function santiagoLabel(iso: string | null): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(time));
}

async function loadOwnCampaign(client: SupabaseClient, scope: Scope, value: string): Promise<BulkCampaign> {
  const campaignId = campaignIdSchema.parse(value);
  const { data, error } = await client.from('bulk_campaigns').select('*')
    .eq('id', campaignId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (error) throw new Error('No se pudo leer la campaña.');
  if (!data) throw new Error('La campaña no está disponible en tu organización.');
  return data as BulkCampaign;
}

type AttemptRow = { draft_id: string; state: 'sent' | 'attention' | 'retry_wait'; code: string; message: string; retry_at: string | null; updated_at: string | null };

type BatchContext = {
  campaign: BulkCampaign;
  deliveries: CampaignDelivery[];
  attempts: AttemptRow[];
  contactedByEmail: Map<string, { status: string | null; sent_at: string | null; replied_at: string | null; reply_intent: string | null }>;
  repliedRows: Array<{ email?: string | null; company?: string | null; replied_at?: string | null }>;
  stagesByLead: Map<string, string[]>;
  accountStages: Map<string, string[] | null>;
  reservations: Map<string, string>;
  batch: { spacing_minutes: number; company_stagger: boolean } | null;
  now: number;
};

async function loadBatchContext(
  client: SupabaseClient, scope: Scope, campaign: BulkCampaign, now?: number,
): Promise<BatchContext> {
  const current = now ?? Date.now();
  const draftIds = campaign.recipients.flatMap(person => person.messages.map(message => message.draftId));
  const emails = [...new Set(campaign.recipients.map(person => person.email.toLowerCase()))];
  const gids = [...new Set(campaign.recipients.flatMap(person =>
    [`lead_saved|${person.leadRef}`, `lead_enriched|${person.leadRef}`]))];
  const [dispatches, attempts, contacted, replied, stages, batch, reservations] = await Promise.all([
    draftIds.length
      ? client.from('outbound_dispatches')
        .select('id,draft_id,version_id,status,completed_at,error_message,error_code,provider_message_id')
        .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).in('draft_id', draftIds).limit(1000)
      : Promise.resolve({ data: [], error: null }),
    client.from('bulk_campaign_attempts').select('draft_id,state,code,message,retry_at,updated_at')
      .eq('campaign_id', campaign.id).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).limit(1000),
    emails.length
      ? client.from('contacted_leads').select('email,status,sent_at,replied_at,reply_intent')
        .eq('organization_id', scope.organizationId).in('email', emails).limit(500)
      : Promise.resolve({ data: [], error: null }),
    client.from('contacted_leads').select('email,company,replied_at')
      .eq('organization_id', scope.organizationId).not('replied_at', 'is', null)
      .order('replied_at', { ascending: false }).limit(200),
    gids.length
      ? client.from('unified_crm_data').select('id,stage').eq('organization_id', scope.organizationId).in('id', gids).limit(200)
      : Promise.resolve({ data: [], error: null }),
    client.from('cowork_send_batches').select('spacing_minutes,company_stagger')
      .eq('organization_id', scope.organizationId).eq('campaign_id', campaign.id).maybeSingle(),
    client.from('cowork_company_send_days').select('recipient_email,send_day')
      .eq('organization_id', scope.organizationId).eq('campaign_id', campaign.id).limit(500),
  ]);
  for (const result of [dispatches, attempts, contacted, replied, stages, batch, reservations]) {
    if (result.error) throw new Error('No se pudo leer el estado del lote; no se asume ausencia de envíos.');
  }
  if ((dispatches.data || []).length >= 1000 || (attempts.data || []).length >= 1000
    || (contacted.data || []).length >= 500 || (stages.data || []).length >= 200
    || (reservations.data || []).length >= 500) throw new Error('Estado del lote incompleto; reduce el alcance.');
  const accountStages = new Map<string, string[] | null>();
  for (const person of campaign.recipients) {
    try { accountStages.set(person.email, (await findNegotiationHold(client, scope, person.email, person.company)).stages); }
    catch { accountStages.set(person.email, null); }
  }
  type ContactedRow = { status: string | null; sent_at: string | null; replied_at: string | null; reply_intent: string | null };
  const contactedByEmail = new Map<string, ContactedRow>(((contacted.data || []) as Array<ContactedRow & { email: string }>)
    .map(row => [String(row.email).toLowerCase(), { status: row.status, sent_at: row.sent_at, replied_at: row.replied_at, reply_intent: row.reply_intent }]));
  const stagesByLead = new Map<string, string[]>();
  for (const row of ((stages.data || []) as Array<{ id: string; stage?: unknown }>)) {
    const leadRef = String(row.id).split('|')[1];
    if (!leadRef || typeof row.stage !== 'string') continue;
    stagesByLead.set(leadRef, [...(stagesByLead.get(leadRef) || []), row.stage]);
  }
  const reservationMap = new Map<string, string>();
  for (const row of ((reservations.data || []) as Array<{ recipient_email: string; send_day: string }>)) {
    const email = String(row.recipient_email).toLowerCase();
    if (!reservationMap.has(email) || row.send_day < reservationMap.get(email)!) reservationMap.set(email, row.send_day);
  }
  const attemptRows = ((attempts.data || []) as Array<Omit<AttemptRow, 'state'> & { state: string }>)
    .filter(row => row.state === 'sent' || row.state === 'attention' || row.state === 'retry_wait')
    .map(row => ({ ...row, state: row.state as AttemptRow['state'] }));
  return {
    campaign,
    deliveries: withSentAttemptsAsDeliveries(((dispatches.data || []) as CampaignDelivery[]), attemptRows),
    attempts: attemptRows,
    contactedByEmail: contactedByEmail as BatchContext['contactedByEmail'],
    repliedRows: (replied.data || []) as BatchContext['repliedRows'],
    stagesByLead,
    accountStages,
    reservations: reservationMap,
    batch: (batch.data as BatchContext['batch']) || null,
    now: current,
  };
}

function touchStates(context: BatchContext, recipient: BulkCampaign['recipients'][number]): TouchState[] {
  return recipient.messages.map((message, index) => {
    const delivery = context.deliveries.find(row => row.draft_id === message.draftId);
    const attempt = context.attempts.find(row => row.draft_id === message.draftId);
    const status = delivery?.status || (attempt?.state === 'sent' ? 'sent' : attempt?.state === 'retry_wait' ? 'deferred' : attempt ? 'failed' : 'planned');
    const code = (delivery as { error_code?: string | null } | undefined)?.error_code || attempt?.code || null;
    const retry = status === 'planned' ? { action: 'not_attempted', reason: 'not_attempted' } : classifySendRetry(status, code);
    let dueAt: string | null = null;
    if (!delivery || delivery.status === 'deferred') {
      const previous = index ? context.deliveries.find(row => row.draft_id === recipient.messages[index - 1].draftId) : null;
      if (!index || (previous?.status === 'sent' && previous.completed_at)) {
        const base = previous?.completed_at || context.campaign.approved_at;
        if (base) dueAt = new Date(Date.parse(base) + message.delayDays * 86400000).toISOString();
      }
    }
    return {
      draftId: message.draftId, versionId: message.versionId,
      dispatchId: (delivery as { id?: string } | undefined)?.id || null,
      index, touchNumber: index + 1, subject: message.subject, delayDays: message.delayDays,
      status, dueAt, dueAtSantiago: santiagoLabel(dueAt),
      sentAt: delivery?.status === 'sent' ? delivery.completed_at || null : null,
      providerMessageId: (delivery as { provider_message_id?: string | null } | undefined)?.provider_message_id || null,
      error: delivery?.error_message || attempt?.message || null,
      retryAt: attempt?.retry_at || null, retryAction: retry.action, retryReason: retry.reason,
    };
  });
}

function accountFlags(context: BatchContext, recipient: BulkCampaign['recipients'][number]) {
  const keys = new Set(companyKeysFor(recipient.email, recipient.company).keys);
  const reply = context.repliedRows.find(row => companyRowMatches(keys, row.email, row.company)) || null;
  const stages = context.accountStages.get(recipient.email) || context.stagesByLead.get(recipient.leadRef) || [];
  const negotiation = stages.filter(stage => (NEGOTIATION_HOLD_STAGES as readonly string[]).includes(stage));
  return {
    companyReplied: reply ? { email: reply.email || null, repliedAt: reply.replied_at || null } : null,
    negotiationStages: negotiation,
    crmStages: stages,
    replyCoverageComplete: context.repliedRows.length < 200,
    negotiationCoverageComplete: context.accountStages.get(recipient.email) !== null,
  };
}

/** 4.2: cada envio y toque con identificador, remitente, destinatario,
 * version, fecha y numero de toque. Solo lectura sobre tu propia campana. */
export async function readCoworkBatchReport(client: SupabaseClient, scope: Scope, value: string) {
  const campaign = await loadOwnCampaign(client, scope, value);
  const context = await loadBatchContext(client, scope, campaign);
  const recipients = campaign.recipients.map(person => {
    const touches = touchStates(context, person);
    const sent = touches.filter(touch => touch.status === 'sent').length;
    return {
      email: person.email, name: person.name, company: person.company,
      reservedDay: context.reservations.get(person.email.toLowerCase()) || null,
      contacted: context.contactedByEmail.get(person.email.toLowerCase()) || null,
      flags: accountFlags(context, person),
      touches, sent, total: touches.length,
    };
  });
  const all = recipients.flatMap(person => person.touches);
  return {
    scope: 'own_campaign_batch',
    campaign: { id: campaign.id, name: campaign.definition.name, status: campaign.status,
      revision: campaign.revision, approvedAt: campaign.approved_at,
      provider: campaign.definition.provider,
      sender: { userId: campaign.user_id, email: null, verified: false,
        limitation: 'El registro de despacho no conserva la dirección real del remitente.' },
      cadence: describeCadence(campaign.definition.messages.map(message => message.delayDays)),
      batch: context.batch },
    summary: {
      recipients: recipients.length,
      touches: all.length,
      sent: all.filter(touch => touch.status === 'sent').length,
      deferred: all.filter(touch => touch.status === 'deferred').length,
      failed: all.filter(touch => touch.status === 'failed').length,
      uncertain: all.filter(touch => ['unknown', 'pending', 'sending'].includes(touch.status)).length,
    },
    recipients,
    limitation: 'Historial de la app con consultas acotadas; la bandeja del proveedor puede traer respuestas aun no sincronizadas.',
  };
}

/** 4.5: elegibilidad del siguiente toque por destinatario, con zona horaria
 * America/Santiago y frenos (respuesta de la empresa, negociacion, fallos
 * terminales, cadencia cambiada). */
export async function readCoworkNextTouch(client: SupabaseClient, scope: Scope, value: string) {
  const campaign = await loadOwnCampaign(client, scope, value);
  const context = await loadBatchContext(client, scope, campaign);
  const cadenceChanged = campaign.status !== 'approved' || !campaign.approved_at;
  const items = campaign.recipients.map(person => {
    const next = nextCampaignMessage(person, context.deliveries, campaign.approved_at || new Date(context.now).toISOString(), context.now);
    const flags = accountFlags(context, person);
    const blockedBy: string[] = [];
    if (cadenceChanged) blockedBy.push('cadence_not_approved');
    if (flags.companyReplied) blockedBy.push('company_replied');
    if (!flags.replyCoverageComplete) blockedBy.push('reply_history_incomplete');
    if (!flags.negotiationCoverageComplete) blockedBy.push('negotiation_history_incomplete');
    if (flags.negotiationStages.length) blockedBy.push(`negotiation:${flags.negotiationStages.join(',')}`);
    if (!next) return { email: person.email, company: person.company, done: true, next: null, blockedBy };
    const touch = touchStates(context, person)[next.index];
    const reservedDay = context.reservations.get(person.email.toLowerCase());
    if (context.batch && (!reservedDay || reservedDay > santiagoDayBounds(new Date(context.now)).day)) blockedBy.push('reserved_day');
    if (touch?.retryAt && Date.parse(touch.retryAt) > context.now) blockedBy.push('retry_wait');
    if (touch?.retryAction === 'reconcile_first') blockedBy.push('reconcile_first');
    const lastSent = Math.max(0, ...context.deliveries.filter(row => row.status === 'sent')
      .map(row => Date.parse(row.completed_at || '')).filter(Number.isFinite));
    if (context.batch && lastSent + context.batch.spacing_minutes * 60000 > context.now) blockedBy.push('batch_spacing');
    if (touch && touch.retryAction === 'terminal' && touch.status !== 'sent') blockedBy.push(`terminal:${touch.retryReason}`);
    if (next.state !== 'ready') blockedBy.push(next.state);
    return {
      email: person.email, company: person.company, done: false,
      next: { touchNumber: next.index + 1, subject: next.message.subject,
        dueAt: touch?.dueAt || null, dueAtSantiago: touch?.dueAtSantiago || null,
        state: next.state, eligible: blockedBy.length === 0 },
      blockedBy,
    };
  });
  return { scope: 'own_campaign_next_touch', campaignId: campaign.id,
    campaignStatus: campaign.status, timeZone: 'America/Santiago',
    todaySantiago: santiagoDayBounds(new Date(context.now)).day,
    items, limitation: 'Elegibilidad calculada sobre registros de la app; el preflight final ocurre antes del proveedor.' };
}

/** 4.6: que se puede reintentar, que es terminal y que debe conciliarse en
 * Contactados antes de repetirse. Nunca propone reenviar un incierto. */
export async function readCoworkRetryReview(client: SupabaseClient, scope: Scope, value: string) {
  const campaign = await loadOwnCampaign(client, scope, value);
  const context = await loadBatchContext(client, scope, campaign);
  const items = campaign.recipients.flatMap(person =>
    touchStates(context, person)
      .filter(touch => touch.status !== 'sent' && touch.status !== 'planned')
      .map(touch => ({
        email: person.email, touchNumber: touch.touchNumber, status: touch.status,
        error: touch.error, retryAt: touch.retryAt,
        action: touch.retryAction, reason: touch.retryReason,
        reconcileAt: touch.retryAction === 'reconcile_first' ? 'Contactados' : null,
        idempotencyNote: 'La clave bulk:campaign:draft protege el despacho; un resultado incierto requiere conciliación antes de reintentar.',
      })));
  return { scope: 'own_campaign_retry_review', campaignId: campaign.id,
    summary: {
      retryable: items.filter(item => item.action === 'retry').length,
      terminal: items.filter(item => item.action === 'terminal').length,
      reconcileFirst: items.filter(item => item.action === 'reconcile_first').length,
    },
    items, limitation: 'Los inciertos exigen conciliar en Contactados; un reintento a ciegas esta prohibido.' };
}

/** 4.3 (planificacion): dia asignado por destinatario para que nunca salgan
 * dos correos a la misma empresa el mismo dia. Programar el lote persiste
 * estas reservas con proteccion concurrente. */
export async function readCoworkCompanyPlan(client: SupabaseClient, scope: Scope, value: string) {
  const campaign = await loadOwnCampaign(client, scope, value);
  const context = await loadBatchContext(client, scope, campaign);
  const startDay = santiagoDayBounds(new Date(context.now)).day;
  const plan = planCompanyDays(
    campaign.recipients.map(person => ({ email: person.email, company: person.company })), startDay);
  const byEmail = new Map(plan.map(item => [item.email, item]));
  return { scope: 'own_campaign_company_plan',
    campaignId: campaign.id, campaignStatus: campaign.status, startDay,
    scheduled: Boolean(context.batch),
    assignments: campaign.recipients.map(person => {
      const slot = byEmail.get(person.email.toLowerCase())!;
      return { email: person.email, company: person.company, companyKey: slot.companyKey,
        basis: slot.basis, sendDay: context.reservations.get(person.email.toLowerCase()) || slot.sendDay,
        reservedDay: context.reservations.get(person.email.toLowerCase()) || null };
    }),
    limitation: 'El plan es determinista; la garantia real la da la reserva persistida mas el preflight antes del proveedor.' };
}
