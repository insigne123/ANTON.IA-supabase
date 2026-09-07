import { NextRequest, NextResponse } from 'next/server';
import { getDailyQuotaStatus, getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import {
  requestAuthErrorResponse,
  requireSessionOrTrustedInternalRequest,
} from '@/lib/server/request-auth';

type R = 'leadSearch' | 'enrich' | 'research' | 'contact';

const RESOURCES: R[] = ['leadSearch', 'enrich', 'research', 'contact'];

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireSessionOrTrustedInternalRequest(req);
    const userId = auth.user.id;
    const organizationId = auth.organizationId;
    if (!organizationId) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 });
    }

    const limits = await getEffectiveDailyQuotaLimits({ userId, organizationId });
    const [credits, contact] = await Promise.all([
      getDailyQuotaStatus({ userId, organizationId, resource: 'search', limit: limits.leadSearch }),
      getDailyQuotaStatus({ userId, organizationId, resource: 'contact', limit: limits.contact }),
    ]);
    const statuses = RESOURCES.map((resource) => ({
      resource,
      ...(resource === 'contact' ? contact : credits),
    }));
    return NextResponse.json({ statuses, credits, contact }, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        Vary: 'Cookie',
      },
    });
  } catch (e: any) {
    const authResponse = requestAuthErrorResponse(e);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: e?.message || 'status error' }, { status: 500 });
  }
}
