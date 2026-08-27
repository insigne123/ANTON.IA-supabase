import { NextRequest, NextResponse } from 'next/server';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isTrustedInternalRequest(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED_INTERNAL_REQUEST' }, { status: 401 });
  }

  return NextResponse.json(
    { error: 'APOLLO_PROVIDER_RETIRED' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}
