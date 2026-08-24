import { NextRequest, NextResponse } from 'next/server';

import { NativeResearchLeadStatusesRequestSchema } from '@/lib/native-research-contracts';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { listNativeResearchLeadStatuses } from '@/lib/server/native-research';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = NativeResearchLeadStatusesRequestSchema.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json({ error: 'NATIVE_RESEARCH_LEAD_IDS_INVALID' }, { status: 400 });
    }

    const items = await listNativeResearchLeadStatuses({
      leadIds: body.data.leadIds,
      access: { organizationId: auth.organizationId, organizationIds: auth.organizationIds, userId: auth.user.id },
    });
    return NextResponse.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[native-research] lead status lookup failed:', error);
    return NextResponse.json({ error: 'NATIVE_RESEARCH_LEAD_STATUS_FAILED' }, { status: 500 });
  }
}
