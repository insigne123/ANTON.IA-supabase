import { NextRequest, NextResponse } from 'next/server';

import { promoteDueCampaignV2Steps } from '@/lib/server/campaigns-v2/cron';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isFirebaseSchedulerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await promoteDueCampaignV2Steps();
    return NextResponse.json({ ok: true, ...result }, { headers: firebaseSchedulerResponseHeaders() });
  } catch (error) {
    console.error('[campaigns-v2] due-state promotion failed', error);
    return NextResponse.json({ error: 'CAMPAIGN_V2_CRON_FAILED' }, { status: 500 });
  }
}

export const GET = POST;
