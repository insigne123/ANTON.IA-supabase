import { NextRequest, NextResponse } from 'next/server';
import { isFirebaseSchedulerRequest, firebaseSchedulerResponseHeaders } from '../_firebase-scheduler-auth';
import { runBulkCampaignWorker } from '@/lib/server/bulk-campaign-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  if (!isFirebaseSchedulerRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.BULK_CAMPAIGNS_ENABLED !== 'true' || process.env.BULK_CAMPAIGNS_AUTOMATION_ENABLED !== 'true') {
    return NextResponse.json({ skipped: true }, { headers: firebaseSchedulerResponseHeaders() });
  }
  try { return NextResponse.json(await runBulkCampaignWorker(), { headers: firebaseSchedulerResponseHeaders() }); }
  catch (error) { console.error('[bulk-campaign-worker]', error); return NextResponse.json({ error: 'CAMPAIGN_WORKER_FAILED' }, { status: 500 }); }
}
