import { NextRequest, NextResponse } from 'next/server';
import { getDailyQuotaStatus } from '@/lib/server/daily-quota-store';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';

type R = 'leadSearch' | 'research' | 'contact';

const RESOURCES: R[] = ['leadSearch', 'research', 'contact'];
const LIMITS: Record<R, number> = { leadSearch: 50, research: 50, contact: 50 };

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id')?.trim() || '';
  if (!userId) {
    return NextResponse.json({ error: 'missing user id' }, { status: 400 });
  }
  if (!isTrustedInternalRequest(req)) {
    return NextResponse.json({ error: 'unauthorized internal request' }, { status: 401 });
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
