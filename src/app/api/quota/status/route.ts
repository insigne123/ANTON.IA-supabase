import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getDailyQuotaStatus } from '@/lib/server/daily-quota-store';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';

type R = 'leadSearch' | 'enrich' | 'research' | 'contact';

const RESOURCES: R[] = ['leadSearch', 'enrich', 'research', 'contact'];
const LIMITS: Record<R, number> = { leadSearch: 50, enrich: 50, research: 50, contact: 50 };

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const userIdFromHeader = req.headers.get('x-user-id')?.trim() || '';

  let userId = userIdFromHeader;

  if (userIdFromHeader) {
    if (!isTrustedInternalRequest(req)) {
      return NextResponse.json({ error: 'unauthorized internal request' }, { status: 401 });
    }
  } else {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    userId = user.id;
  }

  try {
    const statuses = await Promise.all(
      RESOURCES.map(async (resource) => {
        const limit = LIMITS[resource];
        const s = await getDailyQuotaStatus({ userId, resource, limit });
        return { resource, ...s };
      })
    );
    return NextResponse.json({ userId, statuses });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'status error' }, { status: 500 });
  }
}
