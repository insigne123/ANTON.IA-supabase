import { NextRequest, NextResponse } from 'next/server';

import { CampaignV2InboxQuerySchema, CampaignV2InboxResponseSchema } from '@/lib/campaigns-v2/contracts';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { CampaignV2InboxCursorError, getCampaignV2Inbox } from '@/lib/server/campaigns-v2/inbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const queryResult = CampaignV2InboxQuerySchema.safeParse({
      cursor: request.nextUrl.searchParams.get('cursor') || undefined,
    });
    if (!queryResult.success) {
      return NextResponse.json({ error: 'CAMPAIGN_V2_INBOX_QUERY_INVALID' }, { status: 400 });
    }
    const inbox = await getCampaignV2Inbox({
      organizationIds: auth.organizationIds,
      userId: auth.user.id,
      cursor: queryResult.data.cursor,
    });
    const responseResult = CampaignV2InboxResponseSchema.safeParse(inbox);
    if (!responseResult.success) {
      console.error('[campaigns-v2] inbox response contract failed', responseResult.error);
      return NextResponse.json({ error: 'CAMPAIGN_V2_INBOX_READ_FAILED' }, { status: 500 });
    }
    return NextResponse.json(responseResult.data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error instanceof CampaignV2InboxCursorError) {
      return NextResponse.json({ error: 'CAMPAIGN_V2_INBOX_CURSOR_INVALID' }, { status: 400 });
    }
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[campaigns-v2] inbox read failed', error);
    return NextResponse.json({ error: 'CAMPAIGN_V2_INBOX_READ_FAILED' }, { status: 500 });
  }
}
