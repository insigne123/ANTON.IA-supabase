import { NextRequest, NextResponse } from 'next/server';
import { matchesConfiguredSecret } from '@/lib/server/internal-api-auth';
import { processCoworkQueue } from '@/lib/server/cowork/worker';
import { expireStaleCoworkApprovals } from '@/lib/server/cowork/approval-expiry';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!matchesConfiguredSecret(process.env.COWORK_WORKER_SECRET, req.headers.get('x-cowork-worker-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await processCoworkQueue();
    // Once every 15 minutes is enough for a 7-day limit; a failure here never stops the queue (audit C1).
    const approvals = new Date().getUTCMinutes() % 15 === 0
      ? await expireStaleCoworkApprovals(getSupabaseAdminClient()).catch(() => null)
      : null;
    return NextResponse.json(approvals ? { ...result, approvals } : result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'No se pudo procesar la cola Cowork.' }, { status: 503 });
  }
}
