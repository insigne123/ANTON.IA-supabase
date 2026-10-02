import { NextRequest, NextResponse } from 'next/server';

import { reconcileUnknownOutboundDispatches } from '@/lib/server/outbound-reconciliation';
import { releaseIdleContactThreads } from '@/lib/server/contact-thread-release';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isFirebaseSchedulerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const reconciliation = await reconcileUnknownOutboundDispatches();
    // Contacts with no reply 30 days after the last send are free for the team again (Plan 5, PR-9a).
    const release = await releaseIdleContactThreads();
    return NextResponse.json({
      ...reconciliation,
      contactThreadsReleased: release.released,
      ...(release.error ? { contactThreadsReleaseError: release.error } : {}),
    }, {
      headers: firebaseSchedulerResponseHeaders(),
    });
  } catch (error) {
    console.error('[outbound-reconciliation] unexpected error', error);
    return NextResponse.json({ error: 'Outbound reconciliation failed.' }, { status: 500 });
  }
}

export const GET = POST;
