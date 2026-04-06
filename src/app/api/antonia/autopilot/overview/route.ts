import { NextResponse } from 'next/server';

import { countUniqueReplyContacts } from '@/lib/antonia-reply-metrics';
import { resolveAutopilotConfig } from '@/lib/antonia-autopilot';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function mapConfigRow(row: any, organizationId: string) {
  return {
    organizationId,
    notificationEmail: row?.notification_email || '',
    dailyReportEnabled: Boolean(row?.daily_report_enabled ?? true),
    instantAlertsEnabled: Boolean(row?.instant_alerts_enabled ?? true),
    dailySearchLimit: Number(row?.daily_search_limit || 3),
    dailyEnrichLimit: Number(row?.daily_enrich_limit || 50),
    dailyInvestigateLimit: Number(row?.daily_investigate_limit || 20),
    trackingEnabled: Boolean(row?.tracking_enabled ?? false),
    autopilotEnabled: Boolean(row?.autopilot_enabled ?? false),
    autopilotMode: row?.autopilot_mode || 'manual_assist',
    approvalMode: row?.approval_mode || 'low_score_only',
    minAutoSendScore: Number(row?.min_auto_send_score || 70),
    minReviewScore: Number(row?.min_review_score || 45),
    bookingLink: row?.booking_link || '',
    meetingInstructions: row?.meeting_instructions || '',
    replyAutopilotEnabled: Boolean(row?.reply_autopilot_enabled ?? false),
    replyAutopilotMode: row?.reply_autopilot_mode || 'draft_only',
    replyApprovalMode: row?.reply_approval_mode || 'high_risk_only',
    replyMaxAutoTurns: Number(row?.reply_max_auto_turns || 2),
    autoSendBookingReplies: Boolean(row?.auto_send_booking_replies ?? false),
    allowReplyAttachments: Boolean(row?.allow_reply_attachments ?? false),
    pauseOnNegativeReply: Boolean(row?.pause_on_negative_reply ?? true),
    pauseOnFailureSpike: Boolean(row?.pause_on_failure_spike ?? true),
    createdAt: row?.created_at || new Date().toISOString(),
    updatedAt: row?.updated_at || new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const { organizationId } = await requireAuth();
    const admin = getSupabaseAdminClient();

    const todayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';

    const [configRes, missionsRes, processingRes, pendingRes, exceptionRowsRes, contactsRes, repliesRes, contactRowsRes, replyRowsRes, hotRes, hotScoreRes, warmScoreRes, coolScoreRes, coldScoreRes] = await Promise.all([
      admin
        .from('antonia_config')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle(),
      admin
        .from('antonia_missions')
        .select('id, title, status, updated_at, created_at')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(20),
      admin
        .from('antonia_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'processing'),
      admin
        .from('antonia_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'pending'),
      admin
        .from('antonia_exceptions')
        .select('id, mission_id, severity, status, category, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(500),
      admin
        .from('contacted_leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .gte('created_at', todayStart),
      admin
        .from('contacted_leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .not('replied_at', 'is', null)
        .gte('replied_at', todayStart),
      admin
        .from('contacted_leads')
        .select('id, lead_id, email, replied_at, reply_intent, last_reply_text')
        .eq('organization_id', organizationId)
        .gte('created_at', todayStart),
      admin
        .from('lead_responses')
        .select('contacted_id, lead_id, type')
        .eq('organization_id', organizationId)
        .eq('type', 'reply')
        .gte('created_at', todayStart),
      admin
        .from('antonia_exceptions')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'open')
        .in('category', ['positive_reply', 'meeting_request', 'manual_action_required']),
      admin
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('score_tier', 'hot'),
      admin
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('score_tier', 'warm'),
      admin
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('score_tier', 'cool'),
      admin
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('score_tier', 'cold'),
    ]);

    const config = mapConfigRow(configRes.data, organizationId);
    const normalizedConfig = resolveAutopilotConfig(config);
    const exceptionRows = (exceptionRowsRes.data || []) as any[];
    const openExceptions = exceptionRows.filter((item) => item.status === 'open');
    const approvalsPending = openExceptions.filter((item) => item.category === 'approval_required').length;
    const repliesToday = countUniqueReplyContacts((contactRowsRes.data || []) as any[], (replyRowsRes.data || []) as any[])
      || repliesRes.count
      || 0;

    const missions = ((missionsRes.data || []) as any[]);
    const missionSummaries = await Promise.all(
      missions.map(async (mission) => {
        const [readyRes, approvalRes, missionExceptionRes] = await Promise.all([
          admin
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', mission.id)
            .eq('status', 'enriched')
            .not('email', 'is', null),
          admin
            .from('antonia_exceptions')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', mission.id)
            .eq('status', 'open')
            .eq('category', 'approval_required'),
          admin
            .from('antonia_exceptions')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', mission.id)
            .eq('status', 'open'),
        ]);

        return {
          id: mission.id,
          title: mission.title,
          status: mission.status,
          updatedAt: mission.updated_at,
          createdAt: mission.created_at,
          readyToContact: readyRes.count || 0,
          approvalsPending: approvalRes.count || 0,
          openExceptions: missionExceptionRes.count || 0,
        };
      })
    );

    return NextResponse.json({
      config,
      normalizedConfig,
      summary: {
        activeMissions: missions.length,
        tasksProcessing: processingRes.count || 0,
        tasksPending: pendingRes.count || 0,
        openExceptions: openExceptions.length,
        approvalsPending,
        hotLeads: hotRes.count || 0,
        contactsToday: contactsRes.count || 0,
        repliesToday,
      },
      exceptionSummary: {
        critical: openExceptions.filter((item) => item.severity === 'critical').length,
        high: openExceptions.filter((item) => item.severity === 'high').length,
        medium: openExceptions.filter((item) => item.severity === 'medium').length,
        low: openExceptions.filter((item) => item.severity === 'low').length,
      },
      scoreDistribution: {
        hot: hotScoreRes.count || 0,
        warm: warmScoreRes.count || 0,
        cool: coolScoreRes.count || 0,
        cold: coldScoreRes.count || 0,
      },
      missions: missionSummaries,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
