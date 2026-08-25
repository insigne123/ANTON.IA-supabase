import { NextResponse } from 'next/server';
import { z } from 'zod';

import { CampaignV2RecipientStepSendContextResponseSchema } from '@/lib/campaigns-v2/contracts';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getCampaignV2RecipientStepSendContext } from '@/lib/server/campaigns-v2/send-context';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ParamsSchema = z.object({ stepId: z.string().uuid() }).strict();

export async function GET(_request: Request, context: { params: Promise<{ stepId: string }> }) {
  try {
    const auth = await requireAuth();
    const parsedParams = ParamsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'CAMPAIGN_V2_STEP_ID_INVALID' }, { status: 400 });
    }
    const { stepId } = parsedParams.data;

    // Resolve organization and creator ownership with the verified user client
    // before crossing the service-role boundary for dispatch metadata.
    const scopeResult = await auth.supabase
      .from('campaign_recipient_steps')
      .select('campaign_id,organization_id')
      .eq('id', stepId)
      .in('organization_id', auth.organizationIds)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (scopeResult.error) throw scopeResult.error;
    if (!scopeResult.data) {
      return NextResponse.json({ error: 'Campaign recipient step not found' }, { status: 404 });
    }

    const campaignResult = await auth.supabase
      .from('campaigns')
      .select('id')
      .eq('id', scopeResult.data.campaign_id)
      .eq('organization_id', scopeResult.data.organization_id)
      .eq('user_id', auth.user.id)
      .eq('outreach_version', 2)
      .maybeSingle();
    if (campaignResult.error) throw campaignResult.error;
    if (!campaignResult.data) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

    const admin = getSupabaseAdminClient();
    const response = CampaignV2RecipientStepSendContextResponseSchema.parse(
      await getCampaignV2RecipientStepSendContext({
        stepId,
        organizationId: scopeResult.data.organization_id,
        userId: auth.user.id,
        client: admin,
      }),
    );
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[campaigns-v2] recipient step send context read failed', error);
    return NextResponse.json({ error: 'CAMPAIGN_V2_SEND_CONTEXT_READ_FAILED' }, { status: 500 });
  }
}
