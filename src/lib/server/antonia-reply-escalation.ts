import { notificationService } from '@/lib/services/notification-service';
import { createAntoniaException } from '@/lib/server/antonia-exceptions';
import { syncLeadAutopilotToCrm } from '@/lib/server/crm-autopilot';
import type { AutonomousReplyDecision } from '@/lib/antonia-reply-policy';
import { draftAutonomousReply } from '@/lib/server/antonia-reply-drafting';

type EscalateReplyReviewInput = {
  supabase: any;
  organizationId: string;
  missionId?: string | null;
  leadId?: string | null;
  contactedId: string;
  lead: {
    name?: string | null;
    fullName?: string | null;
    email?: string | null;
    company?: string | null;
    companyName?: string | null;
    title?: string | null;
  };
  classification: any;
  decision: AutonomousReplyDecision;
  preview?: string | null;
  suggestedReply?: string | null;
  validationIssues?: string[];
};

function getAppUrl() {
  return String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.antonia.ai').trim().replace(/\/$/, '');
}

export async function maybeEscalateAutonomousReplyReview(input: EscalateReplyReviewInput) {
  if (input.decision.action !== 'review') {
    return null;
  }

  const leadLabel = input.lead.fullName || input.lead.name || input.lead.email || 'Lead';
  const summary = input.classification?.summary || input.preview || 'Reply requiere revision humana';
  const appUrl = getAppUrl();

  const exception = await createAntoniaException(input.supabase, {
    organizationId: input.organizationId,
    missionId: input.missionId || null,
    leadId: input.leadId || null,
    category: 'manual_action_required',
    severity: input.decision.severity === 'critical' ? 'critical' : input.decision.severity === 'high' ? 'high' : 'medium',
    title: `ANTONIA necesita ayuda para responder a ${leadLabel}`,
    description: input.decision.reason,
    dedupeKey: `reply_review_${input.contactedId}`,
    payload: {
      lead: input.lead,
      classification: input.classification,
      preview: input.preview || null,
      decision: input.decision,
      suggestedReply: input.suggestedReply || null,
      validationIssues: input.validationIssues || [],
      contactedId: input.contactedId,
    },
  });

  const wasCreated = Boolean((exception as any)?.__meta?.created ?? true);

  if (!wasCreated) {
    return exception;
  }

  await notificationService.sendAlert(
    input.organizationId,
    'Reply requiere revision humana',
    `ANTONIA no esta segura de como responder a ${leadLabel}. Motivo: ${input.decision.reason}. Revisar: ${appUrl}/contacted/replied`
  );

  if (input.leadId) {
    await syncLeadAutopilotToCrm(input.supabase, {
      organizationId: input.organizationId,
      leadId: input.leadId,
      stage: 'engaged',
      notes: summary,
      nextAction: 'Revisar reply y responder manualmente o aprobar borrador',
      nextActionType: 'reply_human_review',
      nextActionDueAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      autopilotStatus: 'reply_review_required',
      lastAutopilotEvent: 'reply_review_required',
    });
  }

  return exception;
}

export async function maybeEscalateReplyReviewFromContactedId(params: {
  supabase: any;
  organizationId: string;
  userId: string;
  contactedId: string;
  rawReply?: string;
  replySubject?: string;
}) {
  const drafted = await draftAutonomousReply({
    organizationId: params.organizationId,
    userId: params.userId,
    contactedId: params.contactedId,
    rawReply: params.rawReply,
    replySubject: params.replySubject,
  });

  const exception = await maybeEscalateAutonomousReplyReview({
    supabase: params.supabase,
    organizationId: params.organizationId,
    missionId: drafted.contactedLead.missionId || null,
    leadId: drafted.contactedLead.leadId || null,
    contactedId: params.contactedId,
    lead: {
      name: drafted.contactedLead.name,
      fullName: drafted.contactedLead.name,
      email: drafted.contactedLead.email,
      company: drafted.contactedLead.company,
      companyName: drafted.contactedLead.company,
      title: drafted.contactedLead.role,
    },
    classification: drafted.classification,
    decision: drafted.decision,
    preview: drafted.classification.summary || null,
    suggestedReply: drafted.draft?.bodyText || null,
    validationIssues: drafted.validation?.issues || [],
  });

  return { drafted, exception };
}
