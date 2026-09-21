import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** Scoped preview of the v2 enrollment to stop: current state as stored now.
 * Never stops anything; execution re-checks state before acting. */
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
    if (!proposal || proposal.action !== 'cowork.effect' || proposal.kind !== 'campaign_stop_v2') {
      return NextResponse.json({ error: 'No hay propuesta de detención en este trabajo.' }, { status: 409, headers: privateHeaders });
    }
    const parts = String(proposal.targetId || '').split(':');
    if (parts.length !== 3 || parts[0] !== 'campaign-stop') {
      return NextResponse.json({ error: 'La propuesta no es válida.' }, { status: 409, headers: privateHeaders });
    }
    const client = getSupabaseAdminClient();
    const enrollment = await client.from('campaign_enrollments')
      .select('id,campaign_id,status,recipient_name,recipient_email')
      .eq('id', parts[2]).eq('campaign_id', parts[1])
      .eq('organization_id', auth.organizationId).eq('user_id', auth.user.id).maybeSingle();
    if (enrollment.error || !enrollment.data) {
      return NextResponse.json({ error: 'La inscripción ya no está disponible.' }, { status: 409, headers: privateHeaders });
    }
    const campaign = await client.from('campaigns').select('id,name,v2_status')
      .eq('id', parts[1]).eq('organization_id', auth.organizationId).maybeSingle();
    return NextResponse.json({
      matches: true, label: String(proposal.label || ''),
      campaignName: campaign.data?.name ?? null, campaignStatus: campaign.data?.v2_status ?? null,
      recipientName: enrollment.data.recipient_name, recipientEmail: enrollment.data.recipient_email,
      enrollmentStatus: enrollment.data.status,
      stoppable: ['pending_initial_send', 'active'].includes(String(enrollment.data.status || '')),
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
