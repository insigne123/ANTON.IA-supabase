import { NextRequest, NextResponse } from 'next/server';

import { reconcileUnknownOutboundDispatches } from '@/lib/server/outbound-reconciliation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const providedBearer = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const providedCronSecret = String(request.headers.get('x-cron-secret') || '').trim();
  if (!cronSecret || (providedBearer !== cronSecret && providedCronSecret !== cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(await reconcileUnknownOutboundDispatches());
  } catch (error) {
    console.error('[outbound-reconciliation] unexpected error', error);
    return NextResponse.json({ error: 'Outbound reconciliation failed.' }, { status: 500 });
  }
}

export const GET = POST;
