import { NextRequest, NextResponse } from 'next/server';
import { refreshAntoniaDailyRollups } from '@/lib/server/antonia-event-ledger';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(req: NextRequest) {
  if (!isFirebaseSchedulerRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const from = String(req.nextUrl.searchParams.get('from') || '').trim();
  const to = String(req.nextUrl.searchParams.get('to') || '').trim();
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
    return NextResponse.json({ error: 'Invalid rollup date. Use YYYY-MM-DD.' }, { status: 400 });
  }

  try {
    const refreshedRows = await refreshAntoniaDailyRollups({
      from: from || undefined,
      to: to || undefined,
    });
    return NextResponse.json({
      refreshedRows,
      from: from || null,
      to: to || null,
    }, { headers: firebaseSchedulerResponseHeaders() });
  } catch (error) {
    console.error('[cron/antonia-rollups] refresh failed', error);
    return NextResponse.json(
      { error: 'ANTONIA_ROLLUP_REFRESH_FAILED', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export const POST = GET;
