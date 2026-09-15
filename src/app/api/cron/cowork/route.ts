import { NextRequest, NextResponse } from 'next/server';
import { matchesConfiguredSecret } from '@/lib/server/internal-api-auth';
import { processCoworkQueue } from '@/lib/server/cowork/worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!matchesConfiguredSecret(process.env.COWORK_WORKER_SECRET, req.headers.get('x-cowork-worker-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await processCoworkQueue(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'No se pudo procesar la cola Cowork.' }, { status: 503 });
  }
}
