import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { retrySupliaJobStep } from '@/lib/server/suplia-job-runner';
import { getSupliaState } from '@/lib/server/suplia-orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const auth = await requireAuth();
    const { jobId } = await params;
    const body = await req.json().catch(() => ({}));
    const step = await retrySupliaJobStep(auth, jobId, body?.stepId || null);
    if (!step) return NextResponse.json({ error: 'Step no encontrado para reintentar' }, { status: 404 });

    const admin = getSupabaseAdminClient();
    const { data: job, error } = await admin
      .from('suplia_jobs')
      .select('conversation_id')
      .eq('id', jobId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!job) return NextResponse.json({ error: 'Job no encontrado' }, { status: 404 });

    const state = await getSupliaState(auth, job.conversation_id);
    return NextResponse.json({ ...state, toast: 'Step reintentado' });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/job retry] error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo reintentar el step' }, { status: 500 });
  }
}
