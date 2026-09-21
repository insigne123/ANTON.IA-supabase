import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** Scoped preview of the staged exception triage. Never applies anything. */
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
    if (!proposal || proposal.action !== 'cowork.effect' || proposal.kind !== 'exception_resolve') {
      return NextResponse.json({ error: 'No hay propuesta de incidencia en este trabajo.' }, { status: 409, headers: privateHeaders });
    }
    const client = getSupabaseAdminClient();
    const row = await client.from('cowork_exception_proposals')
      .select('exception_id,action,reason,base_updated_at,proposal_hash').eq('run_id', runId)
      .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
    if (row.error || !row.data) {
      return NextResponse.json({ error: 'La propuesta ya no está disponible.' }, { status: 409, headers: privateHeaders });
    }
    const staged = row.data as { exception_id: string; action: string; reason: string;
      base_updated_at: string; proposal_hash: string };
    const current = await client.from('antonia_exceptions').select('title,status,updated_at')
      .eq('id', staged.exception_id).eq('organization_id', auth.organizationId).maybeSingle();
    if (current.error) {
      return NextResponse.json({ error: 'No se pudo leer la incidencia.' }, { status: 503, headers: privateHeaders });
    }
    const fresh = !!current.data && (current.data as { status: string }).status === 'open'
      && (current.data as { updated_at: string }).updated_at === staged.base_updated_at;
    const matches = fresh && `exception:${staged.proposal_hash}` === String(proposal.targetId || '');
    return NextResponse.json({
      action: staged.action, reason: staged.reason, current: current.data,
      matches, fresh, label: String(proposal.label || ''),
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
