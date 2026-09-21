import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { getCoworkRun } from '@/lib/server/cowork/runs';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** Scoped preview of the staged collaboration change. Never applies anything. */
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
    if (!proposal || proposal.action !== 'cowork.effect' || proposal.kind !== 'crm_assign_lead') {
      return NextResponse.json({ error: 'No hay propuesta de asignación en este trabajo.' }, { status: 409, headers: privateHeaders });
    }
    const client = getSupabaseAdminClient();
    const row = await client.from('cowork_crm_assign_proposals')
      .select('lead_id,op,assigned_to_user_id,minutes,base_updated_at,proposal_hash').eq('run_id', runId)
      .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
    if (row.error || !row.data) {
      return NextResponse.json({ error: 'La propuesta ya no está disponible.' }, { status: 409, headers: privateHeaders });
    }
    const staged = row.data as { lead_id: string; op: string; assigned_to_user_id: string | null;
      minutes: number | null; base_updated_at: string; proposal_hash: string };
    const current = await client.from('organization_lead_collaboration')
      .select('assigned_to_user_id,claimed_by_user_id,claim_expires_at,contact_state,updated_at')
      .eq('lead_id', staged.lead_id).eq('organization_id', auth.organizationId).maybeSingle();
    if (current.error) {
      return NextResponse.json({ error: 'No se pudo leer la colaboración.' }, { status: 503, headers: privateHeaders });
    }
    const fresh = !!current.data && (current.data as { updated_at: string }).updated_at === staged.base_updated_at;
    const matches = fresh && `crmassign:${staged.proposal_hash}` === String(proposal.targetId || '');
    const names = new Map<string, string>();
    const ids = [staged.assigned_to_user_id,
      (current.data as { assigned_to_user_id: string | null } | null)?.assigned_to_user_id,
      (current.data as { claimed_by_user_id: string | null } | null)?.claimed_by_user_id].filter(Boolean) as string[];
    if (ids.length) {
      const profiles = await client.from('profiles').select('id,full_name').in('id', [...new Set(ids)]);
      if (!profiles.error) for (const profile of (profiles.data || []) as Array<{ id: string; full_name: string | null }>) {
        names.set(profile.id, profile.full_name || profile.id);
      }
    }
    return NextResponse.json({
      op: staged.op, leadId: staged.lead_id, assignedToUserId: staged.assigned_to_user_id,
      assignedToName: staged.assigned_to_user_id ? names.get(staged.assigned_to_user_id) || null : null,
      minutes: staged.minutes, current: current.data, names: Object.fromEntries(names),
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
