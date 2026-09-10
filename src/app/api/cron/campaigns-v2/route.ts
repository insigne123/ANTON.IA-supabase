import { NextRequest, NextResponse } from 'next/server';

import { promoteDueCampaignV2Steps } from '@/lib/server/campaigns-v2/cron';
import { runCampaignV2AutoSend } from '@/lib/server/campaigns-v2/follow-up-auto-sender';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isFirebaseSchedulerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const promotion = await promoteDueCampaignV2Steps();
    let autoSend = null;
    try {
      autoSend = await runCampaignV2AutoSend({ limit: 25 });
    } catch (error) {
      console.error('[campaigns-v2] auto-send failed', error);
      autoSend = { error: error instanceof Error ? error.message : 'CAMPAIGN_V2_AUTO_SEND_FAILED' };
    }
    return NextResponse.json({ ok: true, ...promotion, autoSend }, { headers: firebaseSchedulerResponseHeaders() });
  } catch (error) {
    console.error('[campaigns-v2] due-state promotion failed', error);
    return NextResponse.json({ error: 'CAMPAIGN_V2_CRON_FAILED' }, { status: 500 });
  }
}

export const GET = POST;
