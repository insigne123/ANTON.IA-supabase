import { NextResponse } from 'next/server';
import { z } from 'zod';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { prepareCampaignV2Draft } from '@/lib/server/campaigns-v2/prepare-draft';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ParamsSchema = z.object({ stepId: z.string().uuid() }).strict();

export async function POST(_request: Request, context: { params: Promise<{ stepId: string }> }) {
  try {
    const auth = await requireAuth();
    const { stepId } = ParamsSchema.parse(await context.params);
    const admin = getSupabaseAdminClient();
    const scopeResult = await admin
      .from('campaign_recipient_steps')
      .select('organization_id')
      .eq('id', stepId)
      .in('organization_id', auth.organizationIds)
      .maybeSingle();
    if (scopeResult.error) throw scopeResult.error;
    if (!scopeResult.data) return NextResponse.json({ error: 'Campaign recipient step not found' }, { status: 404 });
    const response = await prepareCampaignV2Draft({
      stepId,
      organizationId: scopeResult.data.organization_id,
      userId: auth.user.id,
      client: admin,
    });
    return NextResponse.json(response, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'CAMPAIGN_V2_STEP_ID_INVALID' }, { status: 400 });
    }
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[campaigns-v2] native draft preparation failed', error);
    return NextResponse.json({ error: 'CAMPAIGN_V2_DRAFT_PREPARE_FAILED' }, { status: 500 });
  }
}
