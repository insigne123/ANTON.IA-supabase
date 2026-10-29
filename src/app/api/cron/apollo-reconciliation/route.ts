import { NextRequest, NextResponse } from 'next/server';

import { reconcileApolloEnrichmentCallbacks } from '@/lib/server/apollo-enrichment-reconciliation';
import { runEmailFinderTick } from '@/lib/server/email-finder/run';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isFirebaseSchedulerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let result: Awaited<ReturnType<typeof reconcileApolloEnrichmentCallbacks>>;
  try {
    result = await reconcileApolloEnrichmentCallbacks();
  } catch {
    return NextResponse.json(
      { error: 'APOLLO_RECONCILIATION_FAILED' },
      { status: 500, headers: firebaseSchedulerResponseHeaders() },
    );
  }
  // Then the leads Apollo left without an email: look for it with Reoon. Its failure never fails the reconciliation.
  const emailFinder = await runEmailFinderTick().catch((error) => {
    console.error('[email-finder] tick failed', (error as { code?: string })?.code || 'unknown');
    return { error: 'EMAIL_FINDER_FAILED' };
  });
  return NextResponse.json({ ...result, emailFinder }, { headers: firebaseSchedulerResponseHeaders() });
}

export const GET = POST;
