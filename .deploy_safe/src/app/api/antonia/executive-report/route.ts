import { NextResponse } from 'next/server';

import { computeMissionGoalProgress, shortMissionGoalLabel } from '@/lib/antonia-mission-goals';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export async function GET() {
  try {
    const { organizationId } = await requireAuth();
    const admin = getSupabaseAdminClient();

    const { data: missions, error } = await admin
      .from('antonia_missions')
      .select('id, title, status, params, created_at, updated_at')
      .eq('organization_id', organizationId)
      .in('status', ['active', 'paused'])
      .order('updated_at', { ascending: false })
      .limit(25);

    if (error) throw error;

    const missionRows = await Promise.all(((missions || []) as any[]).map(async (mission) => {
      const [contactsRes, repliesRes, positivesRes, meetingsRes, approvalsRes, criticalRes] = await Promise.all([
        admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('mission_id', mission.id),
        admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('mission_id', mission.id).not('replied_at', 'is', null),
        admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('mission_id', mission.id).in('reply_intent', ['positive', 'meeting_request']),
        admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('mission_id', mission.id).eq('reply_intent', 'meeting_request'),
        admin.from('antonia_exceptions').select('*', { count: 'exact', head: true }).eq('mission_id', mission.id).eq('status', 'open').eq('category', 'approval_required'),
        admin.from('antonia_exceptions').select('*', { count: 'exact', head: true }).eq('mission_id', mission.id).eq('status', 'open').in('severity', ['high', 'critical']),
      ]);

      const contacts = Number(contactsRes.count || 0);
      const replies = Number(repliesRes.count || 0);
      const positiveReplies = Number(positivesRes.count || 0);
      const meetings = Number(meetingsRes.count || 0);
      const approvalsPending = Number(approvalsRes.count || 0);
      const criticalOpen = Number(criticalRes.count || 0);
      const progress = computeMissionGoalProgress(mission.params || {}, {
        meetings,
        positiveReplies,
        pipelineValue: (meetings * 2500) + (positiveReplies * 750),
      });

      return {
        id: mission.id,
        title: mission.title,
        status: mission.status,
        playbookName: mission.params?.playbookName || null,
        goalLabel: shortMissionGoalLabel(mission.params || {}),
        progress,
        contacts,
        replies,
        positiveReplies,
        meetings,
        approvalsPending,
        criticalOpen,
        replyRate: percent(replies, contacts),
        positiveRate: percent(positiveReplies, contacts),
        meetingRate: percent(meetings, contacts),
      };
    }));

    const summary = missionRows.reduce((acc, item) => {
      acc.activeMissions += item.status === 'active' ? 1 : 0;
      acc.pausedMissions += item.status === 'paused' ? 1 : 0;
      acc.contacts += item.contacts;
      acc.replies += item.replies;
      acc.positiveReplies += item.positiveReplies;
      acc.meetings += item.meetings;
      acc.approvalsPending += item.approvalsPending;
      acc.atRiskMissions += item.progress.status === 'at_risk' || item.criticalOpen > 0 ? 1 : 0;
      acc.achievedGoals += item.progress.status === 'achieved' ? 1 : 0;
      return acc;
    }, {
      activeMissions: 0,
      pausedMissions: 0,
      contacts: 0,
      replies: 0,
      positiveReplies: 0,
      meetings: 0,
      approvalsPending: 0,
      atRiskMissions: 0,
      achievedGoals: 0,
    });

    const insights: string[] = [];
    if (summary.approvalsPending > 0) {
      insights.push(`Hay ${summary.approvalsPending} aprobaciones pendientes frenando volumen de contacto.`);
    }
    if (summary.atRiskMissions > 0) {
      insights.push(`${summary.atRiskMissions} misiones van atras respecto a su objetivo o tienen riesgo operativo.`);
    }
    if (summary.contacts > 0) {
      insights.push(`Reply rate global: ${percent(summary.replies, summary.contacts)}% · Meeting rate: ${percent(summary.meetings, summary.contacts)}%.`);
    }

    return NextResponse.json({
      summary,
      rates: {
        replyRate: percent(summary.replies, summary.contacts),
        positiveRate: percent(summary.positiveReplies, summary.contacts),
        meetingRate: percent(summary.meetings, summary.contacts),
      },
      missions: missionRows,
      insights,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
