import { NextRequest, NextResponse } from 'next/server';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';
import { captureApolloCreditUsageSnapshot } from '@/lib/server/apollo-usage';
import { checkApifyCredit } from '@/lib/server/apify-credit';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * The hourly provider-usage tick (apolloUsageTick): Apollo's credit snapshot, and what is left of the Apify plan with its
 * low-balance email. Each runs on its own, so one provider failing never skips the other.
 */
export async function POST(req: NextRequest) {
  if (!isFirebaseSchedulerRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apify = await checkApifyCredit(getSupabaseAdminClient())
    .catch(() => ({ provider: 'apify' as const, error: 'APIFY_CREDIT_CHECK_FAILED' }));
  try {
    const result = await captureApolloCreditUsageSnapshot({
      requestId: req.headers.get('x-request-id') || undefined,
      sourceRoute: '/api/cron/apollo-usage',
    });
    return NextResponse.json({ ...result, apify }, { headers: firebaseSchedulerResponseHeaders() });
  } catch {
    return NextResponse.json(
      { error: 'APOLLO_USAGE_CAPTURE_FAILED', apify },
      { status: 500, headers: firebaseSchedulerResponseHeaders() },
    );
  }
}

export const GET = POST;
