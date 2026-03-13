import { NextResponse } from 'next/server';

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
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const byPlaybook = new Map<string, any>();

    for (const mission of (missions || []) as any[]) {
      const playbookId = String(mission?.params?.playbookId || '').trim();
      const playbookName = String(mission?.params?.playbookName || '').trim();
      if (!playbookId) continue;

      const [contactedRes, failedRes, complianceRes] = await Promise.all([
        admin
          .from('contacted_leads')
          .select('id, opened_at, replied_at, reply_intent')
          .eq('mission_id', mission.id)
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
      const contacts = contacted.length;
      const opened = contacted.filter((row) => !!row.opened_at).length;
      const replies = contacted.filter((row) => !!row.replied_at).length;
      const positives = contacted.filter((row) => ['positive', 'meeting_request'].includes(String(row.reply_intent || ''))).length;
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
        openRate: percent(item.opens, item.contacts),
        replyRate: percent(item.replies, item.contacts),
        positiveRate: percent(item.positives, item.contacts),
        deliverabilityRisk: percent(item.failed + item.compliance, item.contacts),
      }))
      .sort((a, b) => b.positiveRate - a.positiveRate);

    return NextResponse.json({ items });
  } catch (error) {
    return handleAuthError(error);
  }
}
