import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** Scoped preview of the staged CRM record change. Never applies anything. */
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
    if (!proposal || proposal.action !== 'cowork.effect' || proposal.kind !== 'crm_update_record') {
      return NextResponse.json({ error: 'No hay propuesta de ficha en este trabajo.' }, { status: 409, headers: privateHeaders });
    }
    const client = getSupabaseAdminClient();
    const row = await client.from('cowork_crm_record_proposals')
      .select('gid,patch,base_updated_at,proposal_hash').eq('run_id', runId)
      .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
    if (row.error || !row.data) {
      return NextResponse.json({ error: 'La propuesta ya no está disponible.' }, { status: 409, headers: privateHeaders });
    }
    const current = await client.from('unified_crm_data')
      .select('stage,owner,notes,next_action,next_action_type,next_action_due_at,meeting_link,updated_at')
      .eq('id', (row.data as { gid: string }).gid).eq('organization_id', auth.organizationId).maybeSingle();
    if (current.error) {
      return NextResponse.json({ error: 'No se pudo leer la ficha comercial.' }, { status: 503, headers: privateHeaders });
    }
    const fresh = (current.data ? (current.data as { updated_at: string }).updated_at : null)
      === (row.data as { base_updated_at: string | null }).base_updated_at;
    const matches = fresh && `crmrecord:${String((row.data as { proposal_hash: string }).proposal_hash)}` === String(proposal.targetId || '');
    return NextResponse.json({
      gid: (row.data as { gid: string }).gid, patch: (row.data as { patch: unknown }).patch,
      current: current.data, matches, fresh, label: String(proposal.label || ''),
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
