import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { FirstContactPlanAutoSendBodySchema } from '@/lib/campaigns-v2/contracts';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import {
  resolveFirstContactPlanOrganization,
  setFirstContactPlanAutoSend,
} from '@/lib/server/campaigns-v2/plan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = FirstContactPlanAutoSendBodySchema.parse(await request.json());
    const organizationId = await resolveFirstContactPlanOrganization({
      draftId: body.draftId,
      userId: auth.user.id,
      organizationIds: auth.organizationIds,
    });
    if (!organizationId) return NextResponse.json({ error: 'Native draft not found' }, { status: 404 });
    const response = await setFirstContactPlanAutoSend({
      draftId: body.draftId,
      autoSend: body.autoSend,
      organizationId,
      userId: auth.user.id,
    });
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: 'CAMPAIGN_V2_INPUT_INVALID', issues: error.issues }, { status: 400 });
    }
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[campaigns-v2] first-contact auto-send update failed', error);
    return NextResponse.json({ error: 'CAMPAIGN_V2_AUTO_SEND_FAILED' }, { status: 500 });
  }
}
