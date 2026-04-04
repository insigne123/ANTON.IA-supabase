import { NextResponse } from 'next/server';

import { countUniqueMeetingRequestContacts, countUniquePositiveReplyContacts, countUniqueReplyContacts, percentWithFloor } from '@/lib/antonia-reply-metrics';
import { computeMissionGoalProgress, shortMissionGoalLabel } from '@/lib/antonia-mission-goals';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const { organizationId } = await requireAuth();
    const admin = getSupabaseAdminClient();

    const { data: missions, error } = await admin
      .from('antonia_missions')
      .select('id, title, status, params, created_at, updated_at')
      .eq('organization_id', organizationId)
      .in('status', ['active', 'paused', 'completed', 'failed'])
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const missionIds = ((missions || []) as any[]).map((mission) => mission.id).filter(Boolean);

    const [contactRowsRes, replyRowsRes] = missionIds.length > 0
      ? await Promise.all([
        admin
          .from('contacted_leads')
          .select('id, mission_id, lead_id, email, replied_at, reply_intent, last_reply_text')
          .in('mission_id', missionIds),
        admin
          .from('lead_responses')
          .select('mission_id, contacted_id, lead_id, type')
          .in('mission_id', missionIds)
          .eq('type', 'reply'),
      ])
      : [{ data: [], error: null } as any, { data: [], error: null } as any];

    if (contactRowsRes.error) throw contactRowsRes.error;
    if (replyRowsRes.error) throw replyRowsRes.error;

    const contactRows = (contactRowsRes.data || []) as any[];
    const replyRows = (replyRowsRes.data || []) as any[];

    const missionRows = await Promise.all(((missions || []) as any[]).map(async (mission) => {
      const [approvalsRes, criticalRes] = await Promise.all([
        admin.from('antonia_exceptions').select('*', { count: 'exact', head: true }).eq('mission_id', mission.id).eq('status', 'open').eq('category', 'approval_required'),
        admin.from('antonia_exceptions').select('*', { count: 'exact', head: true }).eq('mission_id', mission.id).eq('status', 'open').in('severity', ['high', 'critical']),
      ]);

      const missionContacts = contactRows.filter((row) => row.mission_id === mission.id);
      const missionReplies = replyRows.filter((row) => row.mission_id === mission.id);

      const contacts = missionContacts.length;
      const replies = countUniqueReplyContacts(missionContacts, missionReplies);
      const positiveReplies = countUniquePositiveReplyContacts(missionContacts);
      const meetings = countUniqueMeetingRequestContacts(missionContacts);
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
        replyRate: percentWithFloor(replies, contacts),
        positiveRate: percentWithFloor(positiveReplies, contacts),
        meetingRate: percentWithFloor(meetings, contacts),
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
      insights.push(`Reply rate global: ${percentWithFloor(summary.replies, summary.contacts)}% · Meeting rate: ${percentWithFloor(summary.meetings, summary.contacts)}%.`);
    }

    return NextResponse.json({
      summary,
      rates: {
        replyRate: percentWithFloor(summary.replies, summary.contacts),
        positiveRate: percentWithFloor(summary.positiveReplies, summary.contacts),
        meetingRate: percentWithFloor(summary.meetings, summary.contacts),
      },
      missions: missionRows,
      insights,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
