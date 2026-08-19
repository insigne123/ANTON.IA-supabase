import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { captureApolloCreditUsageSnapshot } from '@/lib/server/apollo-usage';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isTrustedInternalRequest(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED_INTERNAL_REQUEST' }, { status: 401 });
  }

  try {
    const result = await captureApolloCreditUsageSnapshot({
      requestId: req.headers.get('x-request-id') || randomUUID(),
      sourceRoute: 'POST /api/internal/observability/apollo-usage',
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[internal/observability/apollo-usage] capture failed', error);
    return NextResponse.json(
      { error: 'APOLLO_USAGE_CAPTURE_FAILED', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 },
    );
  }
}
