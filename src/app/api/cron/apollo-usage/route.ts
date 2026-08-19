import { NextRequest, NextResponse } from 'next/server';
import { captureApolloCreditUsageSnapshot } from '@/lib/server/apollo-usage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const providedBearer = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const providedCronSecret = String(req.headers.get('x-cron-secret') || '').trim();
  if (!cronSecret || (providedBearer !== cronSecret && providedCronSecret !== cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await captureApolloCreditUsageSnapshot({
      requestId: req.headers.get('x-request-id') || undefined,
      sourceRoute: 'POST /api/cron/apollo-usage',
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[cron/apollo-usage] capture failed', error);
    return NextResponse.json(
      { error: 'APOLLO_USAGE_CAPTURE_FAILED', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 },
    );
  }
}

export const GET = POST;
