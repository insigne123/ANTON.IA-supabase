import { NextRequest, NextResponse } from 'next/server';
import { processResearchSequenceQueue } from '@/lib/server/research-sequence-worker';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isFirebaseSchedulerRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await processResearchSequenceQueue();
    return NextResponse.json({ ok: true, ...result }, { headers: firebaseSchedulerResponseHeaders() });
  } catch (error) {
    console.error('[research-sequences/cron] failed', error);
    return NextResponse.json({ error: 'SEQUENCE_WORKER_FAILED' }, { status: 500 });
  }
}
