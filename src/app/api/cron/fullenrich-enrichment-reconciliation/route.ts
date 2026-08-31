import { NextRequest, NextResponse } from 'next/server';

import { reconcileFullEnrichEnrichmentCallbacks } from '@/lib/server/fullenrich-enrichment-reconciliation';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isFirebaseSchedulerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await reconcileFullEnrichEnrichmentCallbacks();
    if (summary.skipped === 'api_key_not_configured') {
      console.error('[fullenrich-enrichment-reconciliation] FULLENRICH_API_KEY is not configured');
      return NextResponse.json({ error: 'FullEnrich API key is not configured.' }, {
        status: 503,
        headers: firebaseSchedulerResponseHeaders(),
      });
    }
    return NextResponse.json(summary, {
      headers: firebaseSchedulerResponseHeaders(),
    });
  } catch (error) {
    console.error('[fullenrich-enrichment-reconciliation] unexpected error', error);
    return NextResponse.json({ error: 'FullEnrich reconciliation failed.' }, { status: 500 });
  }
}

export const GET = POST;
