import { NextRequest, NextResponse } from 'next/server';

import { runPrivacyRetention } from '@/lib/server/privacy-retention';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const cronSecret = String(process.env.CRON_SECRET || '').trim();
    const providedBearer = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
    const providedCronSecret = String(req.headers.get('x-cron-secret') || '').trim();

    if (!cronSecret || (providedBearer !== cronSecret && providedCronSecret !== cronSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRunParam = String(req.nextUrl.searchParams.get('dryRun') || '').toLowerCase();
    const dryRun = dryRunParam === '1' || dryRunParam === 'true' || dryRunParam === 'yes';
    return NextResponse.json(await runPrivacyRetention({ dryRun }));
  } catch (error: any) {
    console.error('[privacy-retention] unexpected error', error);
    return NextResponse.json({ error: 'Privacy retention failed.' }, { status: 500 });
  }
}
