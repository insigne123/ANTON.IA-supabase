import { NextRequest, NextResponse } from 'next/server';

import { processNativeResearchQueue } from '@/lib/server/native-research';
import { matchesConfiguredSecret } from '@/lib/server/internal-api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: NextRequest) {
  return matchesConfiguredSecret(
    process.env.LEAD_RESEARCH_WORKER_SECRET,
    req.headers.get('x-lead-research-worker-secret'),
  );
}

async function run(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const limit = Number(req.nextUrl.searchParams.get('limit') || 5);
    const result = await processNativeResearchQueue({ limit });
    return NextResponse.json({ ok: true, ...result }, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Scheduler-Owner': 'firebase-functions',
      },
    });
  } catch (error: any) {
    console.error('[native-research/cron] failed:', error);
    return NextResponse.json({ ok: false, error: error?.message || 'No se pudo procesar la cola nativa.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
