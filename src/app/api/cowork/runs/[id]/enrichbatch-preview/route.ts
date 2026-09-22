import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** Scoped preview of the staged enrich batch: exact contacts and cost
 * pinned by the proposal target. Never submits anything. */
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
    if (!proposal || proposal.action !== 'cowork.effect' || proposal.kind !== 'enrich_batch') {
      return NextResponse.json({ error: 'No hay propuesta de lote en este trabajo.' }, { status: 409, headers: privateHeaders });
    }
    const client = getSupabaseAdminClient();
    const row = await client.from('cowork_enrich_batch_proposals')
      .select('lead_ids,cost_estimate,patch_hash').eq('run_id', runId)
      .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
    if (row.error || !row.data) {
      return NextResponse.json({ error: 'La propuesta ya no está disponible.' }, { status: 409, headers: privateHeaders });
    }
    const leads = await client.from('leads').select('id,name,company,email')
      .eq('organization_id', auth.organizationId).eq('user_id', auth.user.id)
      .in('id', (row.data.lead_ids || []) as string[]);
    const matches = `enrichbatch:${String(row.data.patch_hash)}` === String(proposal.targetId || '');
    return NextResponse.json({
      leadIds: row.data.lead_ids, costEstimate: row.data.cost_estimate,
      contacts: (leads.data || []).map((lead: { id: string; name?: string | null; company?: string | null; email?: string | null }) => ({
        id: lead.id, name: lead.name, company: lead.company,
        hasEmail: Boolean(lead.email),
      })),
      contactsComplete: (leads.data || []).length === (row.data.lead_ids || []).length,
      matches, label: String(proposal.label || ''),
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
