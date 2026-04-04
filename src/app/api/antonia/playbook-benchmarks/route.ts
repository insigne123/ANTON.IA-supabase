import { NextResponse } from 'next/server';

import { countUniquePositiveReplyContacts, countUniqueReplyContacts, percentWithFloor } from '@/lib/antonia-reply-metrics';
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
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const byPlaybook = new Map<string, any>();

    for (const mission of (missions || []) as any[]) {
      const playbookId = String(mission?.params?.playbookId || '').trim();
      const playbookName = String(mission?.params?.playbookName || '').trim();
      if (!playbookId) continue;

      const [contactedRes, replyRes, failedRes, complianceRes] = await Promise.all([
        admin
          .from('contacted_leads')
          .select('id, mission_id, lead_id, email, opened_at, replied_at, reply_intent, last_reply_text')
          .eq('mission_id', mission.id)
          .limit(5000),
        admin
          .from('lead_responses')
          .select('mission_id, contacted_id, lead_id, type')
          .eq('mission_id', mission.id)
          .eq('type', 'reply')
          .limit(5000),
        admin
          .from('antonia_exceptions')
          .select('id')
          .eq('mission_id', mission.id)
          .eq('category', 'send_failed')
          .limit(5000),
        admin
          .from('antonia_exceptions')
          .select('id')
          .eq('mission_id', mission.id)
          .eq('category', 'compliance_block')
          .limit(5000),
      ]);

      const contacted = (contactedRes.data || []) as any[];
      const replyRows = (replyRes.data || []) as any[];
      const contacts = contacted.length;
      const opened = contacted.filter((row) => !!row.opened_at).length;
      const replies = countUniqueReplyContacts(contacted, replyRows);
      const positives = countUniquePositiveReplyContacts(contacted);
      const failed = (failedRes.data || []).length;
      const compliance = (complianceRes.data || []).length;

      const existing = byPlaybook.get(playbookId) || {
        playbookId,
        playbookName: playbookName || playbookId,
        missions: 0,
        contacts: 0,
        opens: 0,
        replies: 0,
        positives: 0,
        failed: 0,
        compliance: 0,
      };

      existing.missions += 1;
      existing.contacts += contacts;
      existing.opens += opened;
      existing.replies += replies;
      existing.positives += positives;
      existing.failed += failed;
      existing.compliance += compliance;
      byPlaybook.set(playbookId, existing);
    }

    const items = Array.from(byPlaybook.values())
      .map((item) => ({
        ...item,
        openRate: percentWithFloor(item.opens, item.contacts),
        replyRate: percentWithFloor(item.replies, item.contacts),
        positiveRate: percentWithFloor(item.positives, item.contacts),
        deliverabilityRisk: percentWithFloor(item.failed + item.compliance, item.contacts),
      }))
      .sort((a, b) => b.positiveRate - a.positiveRate);

    return NextResponse.json({ items });
  } catch (error) {
    return handleAuthError(error);
  }
}
