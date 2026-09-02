import { NextRequest, NextResponse } from 'next/server';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { captureApolloCreditUsageSnapshot } from '@/lib/server/apollo-usage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isTrustedInternalRequest(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED_INTERNAL_REQUEST' }, { status: 401 });
  }

  try {
    const result = await captureApolloCreditUsageSnapshot({
      requestId: req.headers.get('x-request-id') || undefined,
      sourceRoute: '/api/internal/observability/apollo-usage',
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'APOLLO_USAGE_CAPTURE_FAILED' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
