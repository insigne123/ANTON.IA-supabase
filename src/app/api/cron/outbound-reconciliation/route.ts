import { NextRequest, NextResponse } from 'next/server';

import { reconcileUnknownOutboundDispatches } from '@/lib/server/outbound-reconciliation';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isFirebaseSchedulerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(await reconcileUnknownOutboundDispatches(), {
      headers: firebaseSchedulerResponseHeaders(),
    });
  } catch (error) {
    console.error('[outbound-reconciliation] unexpected error', error);
    return NextResponse.json({ error: 'Outbound reconciliation failed.' }, { status: 500 });
  }
}

export const GET = POST;
