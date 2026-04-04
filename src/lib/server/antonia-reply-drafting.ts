import { buildSuggestedMeetingReply } from '@/lib/antonia-autopilot';
import { buildMissionGoalSummary } from '@/lib/antonia-mission-goals';
import { decideAutonomousReplyAction, resolveReplyAutopilotConfig, type AutonomousReplyDecision } from '@/lib/antonia-reply-policy';
import { validateAutonomousReplyDraft } from '@/lib/antonia-reply-draft-validator';
import { generateAntoniaReply } from '@/ai/flows/generate-antonia-reply';
import { classifyReply, type ReplyClassification } from '@/lib/reply-classifier';
import type { AntoniaConfig } from '@/lib/types';
import { findCachedLeadResearchReport } from '@/lib/server/lead-research-reports';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type ReplyAsset = {
  name: string;
  description?: string;
  url?: string;
};

type DraftAutonomousReplyInput = {
  organizationId: string;
  userId: string;
  contactedId: string;
  rawReply?: string;
  replySubject?: string;
  assets?: ReplyAsset[];
  classificationOverride?: ReplyClassification;
};

function getResearchSummary(report: any) {
  return String(
    report?.enhanced?.overview
    || report?.cross?.overview
    || report?.websiteSummary?.overview
    || ''
  ).trim();
}

function truncate(value: string, max = 320) {
  return String(value || '').trim().slice(0, max);
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function htmlFromText(value: string) {
  return String(value || '')
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function toConfig(row: any): Partial<AntoniaConfig> {
  return {
    organizationId: row?.organization_id,
    bookingLink: row?.booking_link || '',
    meetingInstructions: row?.meeting_instructions || '',
    replyAutopilotEnabled: Boolean(row?.reply_autopilot_enabled ?? false),
    replyAutopilotMode: row?.reply_autopilot_mode || 'draft_only',
    replyApprovalMode: row?.reply_approval_mode || 'high_risk_only',
    replyMaxAutoTurns: Number(row?.reply_max_auto_turns || 2),
    autoSendBookingReplies: Boolean(row?.auto_send_booking_replies ?? false),
    allowReplyAttachments: Boolean(row?.allow_reply_attachments ?? false),
  };
}

export async function draftAutonomousReply(input: DraftAutonomousReplyInput) {
  const admin = getSupabaseAdminClient();

  const { data: contacted } = await admin
    .from('contacted_leads')
    .select('*')
    .eq('id', input.contactedId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (!contacted) {
    throw new Error('Contacted lead not found');
  }

  const [configRes, profileRes, missionRes, replyRes] = await Promise.all([
    admin
      .from('antonia_config')
      .select('*')
      .eq('organization_id', input.organizationId)
      .maybeSingle(),
    admin
      .from('profiles')
      .select('full_name, company_name, company_domain, job_title')
      .eq('id', input.userId)
      .maybeSingle(),
    contacted.mission_id
      ? admin
        .from('antonia_missions')
        .select('id, title, goal_summary, params')
        .eq('id', contacted.mission_id)
        .maybeSingle()
      : Promise.resolve({ data: null } as any),
    admin
      .from('lead_responses')
      .select('type, content, created_at, contacted_id')
      .eq('organization_id', input.organizationId)
      .eq('contacted_id', input.contactedId)
      .order('created_at', { ascending: false })
      .limit(6),
  ]);

  let replyRows = (replyRes.data || []) as any[];
  if (replyRows.length === 0) {
    const fallbackReplies = await admin
      .from('lead_responses')
      .select('type, content, created_at, contacted_id')
      .eq('organization_id', input.organizationId)
      .eq('lead_id', contacted.lead_id)
      .order('created_at', { ascending: false })
      .limit(6);
    replyRows = (fallbackReplies.data || []) as any[];
  }

  const config = toConfig(configRes.data);
  const replyText = truncate(
    input.rawReply
      || contacted.last_reply_text
      || replyRows.find((item: any) => item.type === 'reply')?.content
      || '',
    4000,
  );

  if (!replyText) {
    throw new Error('No reply content available');
  }

  const classification = input.classificationOverride || await classifyReply(replyText);
  const turnCount = replyRows.filter((item: any) => item.type === 'reply').length;
  const decision = decideAutonomousReplyAction({
    config,
    classification,
    rawReply: replyText,
    turnCount,
  });
  let finalDecision: AutonomousReplyDecision = decision;

  const report = await findCachedLeadResearchReport({
    userId: input.userId,
    organizationId: input.organizationId,
    lead: {
      id: contacted.id,
      leadId: contacted.lead_id,
      email: contacted.email,
      company: contacted.company,
      name: contacted.name,
    },
  });

  const missionGoal = missionRes.data?.goal_summary || buildMissionGoalSummary(missionRes.data?.params || {});
  const conversationSummary = [
    contacted.subject ? {
      role: 'outbound' as const,
      subject: contacted.subject,
      text: `Ultimo asunto enviado: ${contacted.subject}`,
      createdAt: contacted.sent_at,
    } : null,
    ...replyRows
      .filter((item) => item.type === 'reply')
      .slice(0, 3)
      .reverse()
      .map((item) => ({
        role: 'inbound' as const,
        text: truncate(item.content || '', 600),
        createdAt: item.created_at,
      })),
  ].filter(Boolean) as Array<{ role: 'outbound' | 'inbound'; subject?: string; text: string; createdAt?: string }>;

  const safeAssets = Array.isArray(input.assets)
    ? input.assets
      .map((asset) => ({
        name: String(asset.name || '').trim(),
        description: String(asset.description || '').trim(),
        url: String(asset.url || '').trim(),
      }))
      .filter((asset) => asset.name)
    : [];
  const enabledAssets = resolveReplyAutopilotConfig(config).allowReplyAttachments ? safeAssets : [];

  let draft = null as null | {
    subject: string;
    bodyText: string;
    bodyHtml: string;
    recommendedAssetNames: string[];
  };

  if (decision.shouldGenerateDraft) {
    try {
      draft = await generateAntoniaReply({
        decisionReason: decision.reason,
        desiredAction: decision.recommendedAction === 'stop' ? 'review' : decision.recommendedAction,
        lead: {
          name: contacted.name || '',
          email: contacted.email || '',
          company: contacted.company || '',
          title: contacted.role || '',
        },
        sender: {
          name: profileRes.data?.full_name || '',
          company: profileRes.data?.company_name || '',
          title: profileRes.data?.job_title || '',
        },
        organizationContext: {
          bookingLink: String(config.bookingLink || ''),
          meetingInstructions: String(config.meetingInstructions || ''),
          missionGoal,
          valueProposition: truncate(getResearchSummary(report), 600),
        },
        lastInbound: {
          subject: input.replySubject || contacted.reply_subject || contacted.subject || '',
          text: replyText,
          intent: classification.intent,
          summary: classification.summary || '',
        },
        conversationSummary,
        researchSummary: truncate(getResearchSummary(report), 1000),
        assets: enabledAssets,
      });
    } catch (error) {
      const fallbackText = buildSuggestedMeetingReply({
        leadName: contacted.name,
        companyName: contacted.company,
        bookingLink: String(config.bookingLink || ''),
        meetingInstructions: String(config.meetingInstructions || ''),
      });
      draft = {
        subject: classification.intent === 'meeting_request' ? 'Coordinemos reunion' : 'Gracias por responder',
        bodyText: fallbackText,
        bodyHtml: htmlFromText(fallbackText),
        recommendedAssetNames: [],
      };
    }
  }

  const validation = draft
    ? validateAutonomousReplyDraft({
      subject: draft.subject,
      bodyText: draft.bodyText,
      bodyHtml: draft.bodyHtml,
      desiredAction: finalDecision.recommendedAction,
      intent: classification.intent,
      bookingLink: String(config.bookingLink || ''),
      allowedAssetNames: enabledAssets.map((asset) => asset.name),
      recommendedAssetNames: draft.recommendedAssetNames,
    })
    : { valid: true, issues: [], severity: 'low' as const };

  if (draft && !validation.valid && finalDecision.action === 'send') {
    finalDecision = {
      ...finalDecision,
      action: 'review',
      recommendedAction: 'review',
      severity: validation.severity === 'high' ? 'high' : 'medium',
      reason: `borrador invalido para auto-send: ${validation.issues.join(', ')}`,
      autoSendAllowed: false,
    };
  }

  return {
    contactedLead: {
      id: contacted.id,
      leadId: contacted.lead_id,
      name: contacted.name,
      email: contacted.email,
      company: contacted.company,
      role: contacted.role,
      missionId: contacted.mission_id,
      subject: contacted.subject,
    },
    classification,
    decision: finalDecision,
    draft,
    validation,
    turnCount,
    replyConfig: resolveReplyAutopilotConfig(config),
    context: {
      missionTitle: missionRes.data?.title || null,
      missionGoal,
      researchFound: Boolean(report),
      conversationEvents: conversationSummary.length,
      assetCount: safeAssets.length,
    },
  };
}
