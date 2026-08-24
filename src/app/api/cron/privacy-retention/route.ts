import { NextRequest, NextResponse } from 'next/server';

import { runPrivacyRetention } from '@/lib/server/privacy-retention';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    if (!isFirebaseSchedulerRequest(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRunParam = String(req.nextUrl.searchParams.get('dryRun') || '').toLowerCase();
    const dryRun = dryRunParam === '1' || dryRunParam === 'true' || dryRunParam === 'yes';
    return NextResponse.json(await runPrivacyRetention({ dryRun }), {
      headers: firebaseSchedulerResponseHeaders(),
    });
  } catch (error: any) {
    console.error('[privacy-retention] unexpected error', error);
    return NextResponse.json({ error: 'Privacy retention failed.' }, { status: 500 });
  }
}

export const POST = GET;
