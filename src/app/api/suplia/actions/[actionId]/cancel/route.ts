import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { cancelSupliaApprovalStep } from '@/lib/server/suplia-job-runner';
import { getSupliaState } from '@/lib/server/suplia-orchestrator';
import { cancelSupliaToolRun } from '@/lib/server/suplia-tool-runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const auth = await requireAuth();
    const { actionId } = await params;
    const body = await req.json().catch(() => ({}));
    const reason = String(body?.reason || '').trim();
    const admin = getSupabaseAdminClient();

    const { data: action, error: actionError } = await admin
      .from('suplia_pending_actions')
      .select('*')
      .eq('id', actionId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle();

    if (actionError) throw actionError;
    if (!action) return NextResponse.json({ error: 'Accion no encontrada' }, { status: 404 });
    if (action.status !== 'pending') return NextResponse.json({ error: 'La accion ya no esta pendiente' }, { status: 409 });
    const editingPlan = reason === 'edit_plan' && action.action_type === 'workflow.approve_plan';

    const now = new Date().toISOString();
    await admin
      .from('suplia_pending_actions')
      .update({ status: 'cancelled', updated_at: now })
      .eq('id', action.id);

    if (action.tool_run_id) await cancelSupliaToolRun(auth, action.tool_run_id);
    await cancelSupliaApprovalStep(auth, { jobId: action.job_id || null, stepId: action.step_id || null, actionId: action.id });

    await admin.from('suplia_messages').insert({
      conversation_id: action.conversation_id,
      organization_id: auth.organizationId,
      user_id: auth.user.id,
      role: 'assistant',
      content: editingPlan
        ? 'Cierro este plan para preparar una version nueva con tus cambios.'
        : `Accion cancelada: ${action.title}`,
      metadata: { actionId: action.id, cancelled: true, reason: editingPlan ? 'edit_plan' : 'user_cancelled' },
    });

    const state = await getSupliaState(auth, action.conversation_id);
    return NextResponse.json({ ...state, toast: editingPlan ? 'Plan listo para editar' : 'Accion cancelada' });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/action cancel] error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo cancelar la accion' }, { status: 500 });
  }
}
