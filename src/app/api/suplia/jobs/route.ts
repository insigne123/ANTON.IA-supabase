import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { createSupliaJobFromMessage, loadSupliaJobsForConversation, runSupliaJob } from '@/lib/server/suplia-job-runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const conversationId = req.nextUrl.searchParams.get('conversationId');
    if (!conversationId) return NextResponse.json({ error: 'conversationId requerido' }, { status: 400 });

    const state = await loadSupliaJobsForConversation(auth, conversationId);
    return NextResponse.json(state);
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/jobs] GET error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo cargar jobs de SUPL.IA' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();
    const conversationId = String(body?.conversationId || '').trim();
    const message = String(body?.message || '').trim();
    if (!conversationId || !message) return NextResponse.json({ error: 'conversationId y message son requeridos' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { data: conversation, error: conversationError } = await admin
      .from('suplia_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) return NextResponse.json({ error: 'Conversacion no encontrada' }, { status: 404 });

    const job = await createSupliaJobFromMessage(auth, { conversationId, message });
    await runSupliaJob(auth, job.id, { maxSteps: 3 });
    const state = await loadSupliaJobsForConversation(auth, conversationId);
    return NextResponse.json({ ...state, job });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/jobs] POST error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo crear el job' }, { status: 500 });
  }
}
