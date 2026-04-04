import { NextRequest, NextResponse } from 'next/server';

import { buildDefaultReplySafetyConfig, runReplySafetyLab } from '@/lib/antonia-reply-lab';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import type { AntoniaConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function mapConfigRow(row: any): Partial<AntoniaConfig> {
  if (!row) return buildDefaultReplySafetyConfig();
  return {
    organizationId: row.organization_id,
    bookingLink: row.booking_link || '',
    meetingInstructions: row.meeting_instructions || '',
    replyAutopilotEnabled: Boolean(row.reply_autopilot_enabled ?? false),
    replyAutopilotMode: row.reply_autopilot_mode || 'draft_only',
    replyApprovalMode: row.reply_approval_mode || 'high_risk_only',
    replyMaxAutoTurns: Number(row.reply_max_auto_turns || 2),
    autoSendBookingReplies: Boolean(row.auto_send_booking_replies ?? false),
    allowReplyAttachments: Boolean(row.allow_reply_attachments ?? false),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { organizationId } = await requireAuth();
    const admin = getSupabaseAdminClient();
    const limit = Math.min(20, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 10)));

    const [configRes, historyRes] = await Promise.all([
      admin
        .from('antonia_config')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle(),
      admin
        .from('antonia_reply_lab_runs')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(limit),
    ]);

    const activeConfig = mapConfigRow(configRes.data);
    const preview = runReplySafetyLab({ config: activeConfig });

    return NextResponse.json({
      activeConfig,
      preview,
      history: historyRes.data || [],
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(_req: NextRequest) {
  try {
    const { user, organizationId } = await requireAuth();
    const admin = getSupabaseAdminClient();

    const { data: configRow } = await admin
      .from('antonia_config')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const config = mapConfigRow(configRow);
    const run = runReplySafetyLab({ config });

    const { data: inserted, error } = await admin
      .from('antonia_reply_lab_runs')
      .insert({
        organization_id: organizationId,
        user_id: user.id,
        mode: 'policy',
        config_snapshot: run.config,
        summary: run.summary,
        results: run.results,
      })
      .select('*')
      .single();

    if (error) throw error;

    return NextResponse.json({
      run,
      saved: inserted,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
