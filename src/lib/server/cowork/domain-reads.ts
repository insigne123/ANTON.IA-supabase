import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoworkDomainRead } from '@/lib/cowork/domain-reads';
import { getCampaignV2Inbox } from '@/lib/server/campaigns-v2/inbox';
import { getFirstContactPlan } from '@/lib/server/campaigns-v2/plan';
import { getCampaignV2RecipientStepSendContext } from '@/lib/server/campaigns-v2/send-context';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';

type Scope = { userId: string; organizationId: string };
type Dependencies = {
  inbox: typeof getCampaignV2Inbox;
  suppressed: typeof isEmailSuppressedForScope;
};
const defaults: Dependencies = { inbox: getCampaignV2Inbox, suppressed: isEmailSuppressedForScope };
const text = (value: unknown, max = 500) => typeof value === 'string' ? value.slice(0, max) : null;

/** All inputs come from a typed tool contract; scope is reconstructed by the
 * worker. No tokens, arbitrary payloads or private mission parameters leave
 * these adapters. Shared services continue to apply provider/feature rules. */
export async function queryCoworkDomainRead(client: SupabaseClient, scope: Scope,
  action: CoworkDomainRead, value: string, dependencies: Dependencies = defaults): Promise<unknown> {
  z.string().uuid().parse(scope.userId); z.string().uuid().parse(scope.organizationId);
  if (action === 'campaigns.plan') {
    return queryCoworkCampaignPlan(client, scope, z.string().uuid().parse(value));
  }
  if (action === 'campaigns.step_context') {
    return queryCoworkCampaignStepContext(client, scope, z.string().uuid().parse(value));
  }
  if (action === 'campaigns.inbox') {
    z.literal('').parse(value);
    const inbox = await dependencies.inbox({ organizationIds: [scope.organizationId], userId: scope.userId, client });
    return { scope: 'own_campaigns_v2', enabled: inbox.enabled,
      items: inbox.items.slice(0, 20).map(item => ({
        stepId: item.stepId, campaignId: item.campaignId, enrollmentId: item.enrollmentId,
        campaignName: text(item.campaignName), recipientName: text(item.recipientName),
        recipientEmail: text(item.recipientEmail), stepName: text(item.stepName), state: item.state,
        dueAt: item.dueAt, nextAction: item.nextAction, nativeDraftId: item.nativeDraftId,
      })), limit: 20, returned: Math.min(inbox.items.length, 20),
      truncated: inbox.page.hasMore || inbox.items.length > 20 };
  }
  if (action === 'missions.list' || action === 'exceptions.list') {
    z.literal('').parse(value);
    const missions = action === 'missions.list';
    let query = client.from(missions ? 'antonia_missions' : 'antonia_exceptions')
      .select(missions ? 'id,title,status,goal_summary,created_at,updated_at' : 'id,mission_id,lead_id,title,status,created_at,updated_at')
      .eq('organization_id', scope.organizationId);
    if (missions) query = query.eq('user_id', scope.userId);
    else query = query.eq('status', 'open');
    const { data, error } = await query.order('created_at', { ascending: false }).limit(21);
    if (error) throw new Error(missions ? 'No se pudieron consultar tus misiones.' : 'No se pudieron consultar las incidencias del equipo.');
    const rows = z.array(z.object({
      id: z.string(), title: z.string().nullable().optional(), status: z.string(),
      goal_summary: z.string().nullable().optional(), mission_id: z.string().nullable().optional(), lead_id: z.string().nullable().optional(),
      created_at: z.string().optional(), updated_at: z.string().optional(),
    })).parse(data || []);
    return { scope: missions ? 'own_missions' : 'organization_open_exceptions',
      items: rows.slice(0, 20).map(row => ({ id: row.id, title: text(row.title), status: text(row.status, 60),
        ...(missions ? { goalSummary: text(row.goal_summary) } : { missionId: row.mission_id, leadId: row.lead_id }),
        createdAt: row.created_at, updatedAt: row.updated_at })),
      returned: Math.min(rows.length, 20), limit: 20, truncated: rows.length > 20 };
  }
  const leadId = z.string().uuid().parse(value);
  const lead = await client.from('leads').select('id,email')
    .eq('id', leadId).eq('organization_id', scope.organizationId).maybeSingle();
  if (lead.error) throw new Error('No se pudo comprobar el contacto.');
  if (!lead.data) throw new Error('Contacto no disponible en esta organización.');
  if (action === 'crm.record') {
    const gids = [`lead_saved|${leadId}`, `lead_enriched|${leadId}`];
    const rows: Array<{ gid: string; stage: unknown; owner: unknown; notes: unknown;
      nextAction: unknown; nextActionDueAt: unknown; autopilotStatus: unknown; updatedAt: unknown }> = [];
    for (const gid of gids) {
      const record = await client.from('unified_crm_data')
        .select('id,stage,owner,notes,next_action,next_action_due_at,autopilot_status,updated_at')
        .eq('id', gid).eq('organization_id', scope.organizationId).maybeSingle();
      if (record.error) throw new Error('No se pudo consultar la ficha comercial.');
      if (record.data) rows.push({
        gid: record.data.id, stage: record.data.stage, owner: record.data.owner,
        notes: typeof record.data.notes === 'string' ? record.data.notes.slice(0, 2000) : null,
        nextAction: record.data.next_action, nextActionDueAt: record.data.next_action_due_at,
        autopilotStatus: record.data.autopilot_status, updatedAt: record.data.updated_at,
      });
    }
    return { scope: 'organization_crm_record', leadId, records: rows,
      notice: rows.length === 0 ? 'Sin ficha comercial registrada para este contacto.' : undefined };
  }
  if (action === 'crm.collaboration') {
    const org = await client.from('organizations').select('collaboration_v1_enabled').eq('id', scope.organizationId).maybeSingle();
    if (org.error) throw new Error('No se pudo comprobar la colaboración del equipo.');
    if (!org.data?.collaboration_v1_enabled) return { scope: 'organization_collaboration', leadId, enabled: false, collaboration: null };
    const collaboration = await client.from('organization_lead_collaboration')
      .select('assigned_to_user_id,claimed_by_user_id,claim_expires_at,updated_at')
      .eq('organization_id', scope.organizationId).eq('lead_id', leadId).maybeSingle();
    if (collaboration.error) throw new Error('No se pudo consultar el responsable del contacto.');
    const row = collaboration.data;
    return { scope: 'organization_collaboration', leadId, enabled: true, collaboration: row ? {
      assignedToUserId: row.assigned_to_user_id, claimedByUserId: row.claimed_by_user_id,
      claimExpiresAt: row.claim_expires_at, updatedAt: row.updated_at,
    } : null };
  }
  const email = String(lead.data.email || '').trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) return { scope: 'organization_contactability', leadId, status: 'missing_email', reasons: ['missing_email'] };
  return { scope: 'organization_contactability', leadId,
    ...(await checkContactability(client, scope, email)), notice: 'Consulta informativa. No verifica el buzón ni autoriza un envío; el motor vuelve a comprobarlo al enviar.' };
}

async function checkContactability(client: SupabaseClient, scope: Scope, email: string,
  dependencies: Dependencies = defaults) {
  const [suppressed, domain, latest] = await Promise.all([
    dependencies.suppressed(email, scope),
    client.from('excluded_domains').select('id').eq('organization_id', scope.organizationId).eq('domain', email.split('@')[1]).maybeSingle(),
    client.from('contacted_leads').select('delivery_status,evaluation_status,campaign_followup_allowed,bounced_at,reply_intent')
      .eq('organization_id', scope.organizationId).eq('email', email)
      .order('sent_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (domain.error || latest.error) throw new Error('No se pudo comprobar si puedes contactar a esta persona.');
  const reasons: string[] = [];
  if (suppressed) reasons.push('unsubscribe_or_privacy_block');
  if (domain.data) reasons.push('blocked_domain');
  if (latest.data?.evaluation_status === 'do_not_contact' || latest.data?.campaign_followup_allowed === false) reasons.push('do_not_contact');
  if (latest.data?.reply_intent === 'unsubscribe') reasons.push('unsubscribe_reply');
  const blocked = reasons.length > 0;
  if (latest.data?.bounced_at || String(latest.data?.delivery_status || '').includes('bounce')) reasons.push('recent_bounce');
  return { status: blocked ? 'blocked' : reasons.length ? 'warning' : 'ok', reasons };
}

/** Batch contactability for up to 5 observed leads. Same checks as the
 * single read, reported per recipient; one bad mailbox never blocks the rest.
 * Informative only: never verifies deliverability nor authorizes sends. */
export async function queryCoworkContactabilityBatch(client: SupabaseClient, scope: Scope,
  rawLeadIds: unknown, dependencies: Dependencies = defaults) {
  const leadIds = z.array(z.string().uuid()).min(1).max(5).parse(rawLeadIds);
  if (new Set(leadIds).size !== leadIds.length) throw new Error('Hay contactos duplicados.');
  z.string().uuid().parse(scope.userId); z.string().uuid().parse(scope.organizationId);
  const results = [];
  for (const leadId of leadIds) {
    const lead = await client.from('leads').select('id,email')
      .eq('id', leadId).eq('organization_id', scope.organizationId).maybeSingle();
    if (lead.error) throw new Error('No se pudo comprobar un contacto.');
    if (!lead.data) {
      results.push({ leadId, status: 'unavailable', reasons: ['not_in_organization'] });
      continue;
    }
    const email = String(lead.data.email || '').trim().toLowerCase();
    if (!z.string().email().safeParse(email).success) {
      results.push({ leadId, status: 'missing_email', reasons: ['missing_email'] });
      continue;
    }
    results.push({ leadId, ...(await checkContactability(client, scope, email, dependencies)) });
  }
  return { scope: 'organization_contactability_batch', results, returned: results.length, limit: 5 };
}

/** First-contact follow-up plan of a v2 campaign draft. Bodies are dropped:
 * the agent sees structure, states and due dates, never full message text. */
export async function queryCoworkCampaignPlan(client: SupabaseClient, scope: Scope, draftId: string) {
  z.string().uuid().parse(draftId);
  z.string().uuid().parse(scope.userId); z.string().uuid().parse(scope.organizationId);
  const response = await getFirstContactPlan({ draftId, organizationId: scope.organizationId, userId: scope.userId, client });
  if (!response.enabled || !response.plan) {
    return { scope: 'own_campaign_v2_plan', enabled: response.enabled, plan: null };
  }
  const plan = response.plan;
  return { scope: 'own_campaign_v2_plan', enabled: true,
    plan: { campaignId: plan.campaignId, campaignName: plan.campaignName.slice(0, 160),
      lifecycleState: plan.lifecycleState, enrollmentId: plan.enrollmentId,
      enrollmentState: plan.enrollmentState, nextDueAt: plan.nextDueAt, autoSend: plan.autoSend ?? null,
      steps: plan.steps.map(step => ({ id: step.id, name: step.name.slice(0, 120),
        state: step.state, dueAt: step.dueAt, nativeDraftId: step.nativeDraftId,
        draftReady: step.draftGeneration.status === 'ready' })) } };
}

/** Dispatch state of one v2 recipient step. Provider internals stay out;
 * only state, draft linkage and error summary are exposed. */
export async function queryCoworkCampaignStepContext(client: SupabaseClient, scope: Scope, stepId: string) {
  z.string().uuid().parse(stepId);
  z.string().uuid().parse(scope.userId); z.string().uuid().parse(scope.organizationId);
  const context = await getCampaignV2RecipientStepSendContext({
    stepId, organizationId: scope.organizationId, userId: scope.userId, client,
  });
  return { scope: 'own_campaign_v2_step', stepId: context.stepId, state: context.state,
    nativeDraftId: context.nativeDraftId, nativeVersionId: context.nativeVersionId,
    dispatch: context.dispatch ? { status: context.dispatch.status, provider: context.dispatch.provider,
      errorCode: context.dispatch.errorCode, errorMessage: context.dispatch.errorMessage } : null };
}
