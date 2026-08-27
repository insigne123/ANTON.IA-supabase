import { NextRequest, NextResponse } from 'next/server';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isFirebaseSchedulerRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(
    { error: 'APOLLO_PROVIDER_RETIRED' },
    { status: 410, headers: firebaseSchedulerResponseHeaders() },
  );
}

export const GET = POST;
