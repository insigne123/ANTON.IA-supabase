import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAuth, handleAuthError } from '@/lib/server/auth-utils';
import { isStageSuggestionDecision } from '@/lib/crm-stage-suggestions';

export const dynamic = 'force-dynamic';

/** Pending pipeline stage suggestions of the organization (Plan 5, PR-10), read with the person's client (RLS). */
export async function GET() {
  try {
    const { organizationId, supabase } = await requireAuth();
    const { data, error } = await supabase.from('crm_stage_suggestions')
      .select('id,crm_id,from_stage,to_stage,reason,source,created_at')
      .eq('organization_id', organizationId).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return NextResponse.json({ suggestions: data || [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleAuthError(error); }
}

/** Accept or dismiss suggestions; accepting moves the stage unless the lead already moved past it. */
export async function POST(req: NextRequest) {
  try {
    const { supabase } = await requireAuth();
    const body = await req.json().catch(() => null);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string').slice(0, 500) : [];
    if (!ids.length || !isStageSuggestionDecision(body?.decision)) throw new AuthError('Elige qué sugerencias aceptar o descartar', 400);
    const { data, error } = await supabase.rpc('decide_crm_stage_suggestions_v1', { p_ids: ids, p_decision: body.decision });
    if (error) {
      if (error.code === '42501') throw new AuthError('No puedes decidir estas sugerencias', 403);
      if (error.code === '22023' || error.code === '22P02') throw new AuthError('Elige qué sugerencias aceptar o descartar', 400);
      throw error;
    }
    return NextResponse.json(data || { accepted: 0, dismissed: 0, superseded: 0 }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleAuthError(error); }
}
