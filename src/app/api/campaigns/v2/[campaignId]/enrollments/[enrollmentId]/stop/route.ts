import { NextResponse } from 'next/server';
import { z } from 'zod';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { stopCampaignV2Enrollment } from '@/lib/server/campaigns-v2/stop';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ParamsSchema = z.object({
  campaignId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
}).strict();

export async function POST(
  _request: Request,
  context: { params: Promise<{ campaignId: string; enrollmentId: string }> },
) {
  try {
    const auth = await requireAuth();
    const params = ParamsSchema.parse(await context.params);
    const admin = getSupabaseAdminClient();
    const scopeResult = await admin
      .from('campaigns')
      .select('organization_id')
      .eq('id', params.campaignId)
      .eq('outreach_version', 2)
      .in('organization_id', auth.organizationIds)
      .maybeSingle();
    if (scopeResult.error) throw scopeResult.error;
    if (!scopeResult.data) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    const response = await stopCampaignV2Enrollment({
      ...params,
      organizationId: scopeResult.data.organization_id,
      userId: auth.user.id,
      client: admin,
    });
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'CAMPAIGN_V2_STOP_INPUT_INVALID' }, { status: 400 });
    }
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[campaigns-v2] enrollment stop failed', error);
    return NextResponse.json({ error: 'CAMPAIGN_V2_STOP_FAILED' }, { status: 500 });
  }
}
