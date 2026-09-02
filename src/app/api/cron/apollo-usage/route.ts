import { NextRequest, NextResponse } from 'next/server';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';
import { captureApolloCreditUsageSnapshot } from '@/lib/server/apollo-usage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isFirebaseSchedulerRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await captureApolloCreditUsageSnapshot({
      requestId: req.headers.get('x-request-id') || undefined,
      sourceRoute: '/api/cron/apollo-usage',
    });
    return NextResponse.json(result, { headers: firebaseSchedulerResponseHeaders() });
  } catch {
    return NextResponse.json(
      { error: 'APOLLO_USAGE_CAPTURE_FAILED' },
      { status: 500, headers: firebaseSchedulerResponseHeaders() },
    );
  }
}

export const GET = POST;
