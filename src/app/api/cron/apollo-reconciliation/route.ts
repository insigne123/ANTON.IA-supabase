import { NextRequest, NextResponse } from 'next/server';

import { reconcileApolloEnrichmentCallbacks } from '@/lib/server/apollo-enrichment-reconciliation';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isFirebaseSchedulerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await reconcileApolloEnrichmentCallbacks();
    return NextResponse.json(result, { headers: firebaseSchedulerResponseHeaders() });
  } catch {
    return NextResponse.json(
      { error: 'APOLLO_RECONCILIATION_FAILED' },
      { status: 500, headers: firebaseSchedulerResponseHeaders() },
    );
  }
}

export const GET = POST;
