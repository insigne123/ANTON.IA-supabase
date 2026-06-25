import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { resumeSupliaJob } from '@/lib/server/suplia-job-runner';
import { getSupliaState } from '@/lib/server/suplia-orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const auth = await requireAuth();
    const { jobId } = await params;
    const job = await resumeSupliaJob(auth, jobId);
    if (!job) return NextResponse.json({ error: 'Job no encontrado o no pausado' }, { status: 404 });
    const state = await getSupliaState(auth, job.conversationId);
    return NextResponse.json({ ...state, toast: 'Job reanudado' });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/job resume] error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo reanudar el job' }, { status: 500 });
  }
}
