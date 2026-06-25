import { NextRequest, NextResponse } from 'next/server';

import { runSupliaScheduler } from '@/lib/server/suplia-job-scheduler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: NextRequest) {
  const secret = String(process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET || '').trim();
  if (!secret) return true;
  const headerSecret = String(req.headers.get('x-internal-api-secret') || '').trim();
  const bearer = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return headerSecret === secret || bearer === secret;
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const limit = Number(req.nextUrl.searchParams.get('limit') || 5);
    const maxJobsPerOrganization = Number(req.nextUrl.searchParams.get('maxJobsPerOrganization') || process.env.SUPLIA_MAX_JOBS_PER_ORG || 1);
    const result = await runSupliaScheduler({ limit, maxJobsPerOrganization });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error('[SUPLIA/cron] error:', error);
    return NextResponse.json({ ok: false, error: error?.message || 'No se pudo ejecutar scheduler SUPL.IA' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
