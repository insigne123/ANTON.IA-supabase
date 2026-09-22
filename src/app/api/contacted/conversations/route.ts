import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, handleAuthError } from '@/lib/server/auth-utils';
import { loadPlannedTouches } from '@/lib/server/contacted-conversations';

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const { supabase, organizationId, user } = await requireAuth();
    const offset = Math.max(0, Math.min(100000, Number(req.nextUrl.searchParams.get('offset')) || 0));
    const result = await supabase.from('contacted_leads').select('id,user_id,organization_id,lead_id,name,email,company,subject,provider,status,sent_at,replied_at,reply_intent,reply_preview,reply_summary,reply_subject,last_reply_text,opened_at,click_count,scheduled_at,conversation_resolved_at,conversation_outbound_at,reply_sync_succeeded_at,reply_sync_error,message_id,thread_id,conversation_id,internet_message_id').eq('organization_id', organizationId).order('id').range(offset, offset + 99);
    if (result.error) throw result.error;
    const leadRefs = [...new Set<string>((result.data || []).map((r: any) => String(r.lead_id || '')).filter(Boolean))];
    let phaseComplete = true;
    if (leadRefs.length) {
      const crm = await supabase.from('unified_crm_data').select('id,stage').eq('organization_id', organizationId).in('id', leadRefs.flatMap(id => [`lead_saved|${id}`, `lead_enriched|${id}`])).limit(200);
      if (crm.error || (crm.data || []).length >= 200) phaseComplete = false;
      const stages = new Map<string, string>();
      for (const item of crm.data || []) { const leadId = String(item.id).split('|')[1]; if (leadId && item.stage) stages.set(leadId, item.stage); }
      for (const row of result.data || []) row.crm_stage = stages.get(String(row.lead_id || '')) || null;
    }
    let plans;
    try { plans = await loadPlannedTouches(supabase, organizationId, [...new Set<string>((result.data || []).map((r: any) => r.email).filter(Boolean))], [...new Set<string>((result.data || []).map((r: any) => r.user_id).filter(Boolean))]); }
    catch { plans = { touches: [], complete: false }; }
    return NextResponse.json({ rows: result.data, plans, coverageComplete: phaseComplete, userId: user.id, nextOffset: result.data.length === 100 ? offset + 100 : null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleAuthError(error); }
}
