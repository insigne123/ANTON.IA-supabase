import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { getCampaignV2RecipientStepSendContext } from '@/lib/server/campaigns-v2/send-context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** Scoped preview of the staged v2 draft preparation. Never prepares anything. */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const runId = (await context.params).id;
    const state = await getCoworkRun(auth, runId);
    if (!state) return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404, headers: privateHeaders });
    const proposal = state.events.slice().reverse()
      .find((event: { kind: string }) => event.kind === 'approval.requested')?.payload as {
        action?: string; kind?: string; targetId?: string; label?: string;
      } | undefined;
    if (!proposal || proposal.action !== 'cowork.effect' || proposal.kind !== 'campaign_prepare_draft_v2') {
      return NextResponse.json({ error: 'No hay propuesta de preparación en este trabajo.' }, { status: 409, headers: privateHeaders });
    }
    const client = getSupabaseAdminClient();
    const row = await client.from('cowork_campaign_prepare_proposals')
      .select('step_id,base_state,proposal_hash').eq('run_id', runId)
      .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
    if (row.error || !row.data) {
      return NextResponse.json({ error: 'La propuesta ya no está disponible.' }, { status: 409, headers: privateHeaders });
    }
    const stepId = (row.data as { step_id: string }).step_id;
    let current: { state: string; nativeDraftId: string | null } | null = null;
    try {
      const context = await getCampaignV2RecipientStepSendContext({
        stepId, organizationId: auth.organizationId, userId: auth.user.id, client,
      });
      current = { state: context.state, nativeDraftId: context.nativeDraftId };
    } catch {
      current = null;
    }
    const fresh = !!current && !current.nativeDraftId
      && current.state === (row.data as { base_state: string }).base_state;
    const matches = fresh && `campaignprep:${String((row.data as { proposal_hash: string }).proposal_hash)}` === String(proposal.targetId || '');
    return NextResponse.json({
      stepId, current, matches, fresh, label: String(proposal.label || ''),
    }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return NextResponse.json({ error: 'No se pudo cargar la vista previa.' }, { status: 503, headers: privateHeaders });
  }
}
