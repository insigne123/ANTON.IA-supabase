import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** Scoped preview of the staged saved-search change. Never applies anything. */
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
    if (!proposal || proposal.action !== 'cowork.effect'
      || !['saved_search_create', 'saved_search_update', 'saved_search_delete'].includes(String(proposal.kind))) {
      return NextResponse.json({ error: 'No hay propuesta de búsqueda en este trabajo.' }, { status: 409, headers: privateHeaders });
    }
    const client = getSupabaseAdminClient();
    const row = await client.from('cowork_saved_search_proposals')
      .select('op,search_id,name,criteria,is_shared,proposal_hash,base_updated_at').eq('run_id', runId)
      .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
    if (row.error || !row.data) {
      return NextResponse.json({ error: 'La propuesta ya no está disponible.' }, { status: 409, headers: privateHeaders });
    }
    const op = row.data.op;
    let fresh = true;
    if (op !== 'create') {
      const current = await client.from('saved_searches').select('updated_at')
        .eq('id', row.data.search_id).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
      fresh = !current.error && !!current.data && current.data.updated_at === row.data.base_updated_at;
    }
    const matches = fresh && `savedsearch:${op}:${String(row.data.proposal_hash)}` === String(proposal.targetId || '');
    return NextResponse.json({
      op, matches, name: row.data.name, criteria: row.data.criteria,
      current: op === 'delete' ? { name: row.data.name, is_shared: row.data.is_shared } : undefined,
      isShared: row.data.is_shared, label: String(proposal.label || ''),
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
