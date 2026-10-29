import { NextRequest, NextResponse } from 'next/server';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';
import { captureApolloCreditUsageSnapshot } from '@/lib/server/apollo-usage';
import { checkApifyCredit } from '@/lib/server/apify-credit';
import { checkApolloCredit, checkReoonCredit } from '@/lib/server/provider-alerts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * The hourly provider-usage tick (apolloUsageTick): Apollo's credit snapshot, and what is left of the Apify plan, of Apollo's
 * lead credits and of Reoon's credits, each with its low-balance email (apify-credit.ts, provider-alerts.ts). Each runs on
 * its own, so one provider failing never skips another.
 */
export async function POST(req: NextRequest) {
  if (!isFirebaseSchedulerRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getSupabaseAdminClient();
  const apify = await checkApifyCredit(client)
    .catch(() => ({ provider: 'apify' as const, error: 'APIFY_CREDIT_CHECK_FAILED' }));
  const reoon = await checkReoonCredit(client)
    .catch(() => ({ provider: 'reoon' as const, error: 'REOON_CREDIT_CHECK_FAILED' }));
  try {
    const { creditUsage, ...result } = await captureApolloCreditUsageSnapshot({
      requestId: req.headers.get('x-request-id') || undefined,
      sourceRoute: '/api/cron/apollo-usage',
    });
    const apollo = await checkApolloCredit(client, creditUsage)
      .catch(() => ({ provider: 'apollo' as const, error: 'APOLLO_CREDIT_CHECK_FAILED' }));
    return NextResponse.json({ ...result, apify, reoon, apolloCredit: apollo }, { headers: firebaseSchedulerResponseHeaders() });
  } catch {
    return NextResponse.json(
      { error: 'APOLLO_USAGE_CAPTURE_FAILED', apify, reoon },
      { status: 500, headers: firebaseSchedulerResponseHeaders() },
    );
  }
}

export const GET = POST;
