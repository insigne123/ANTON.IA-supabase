import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { resolveTrackingToken } from '@/lib/server/tracking-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const token = resolveTrackingToken(req.nextUrl.searchParams.get('t'), 'click');
    if (!token?.destination) {
        return NextResponse.json(
            { error: 'Invalid tracking link' },
            { status: 400, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }
        );
    }

    try {
        const supabase = getSupabaseAdminClient();
        const { data: row, error: fetchError } = await supabase
            .from('contacted_leads')
            .select('id, click_count, engagement_score')
            .eq('id', token.contactedId)
            .eq('organization_id', token.organizationId)
            .maybeSingle();
        if (fetchError) throw fetchError;

        if (row) {
            const nowIso = new Date().toISOString();
            const { error: updateError } = await supabase
                .from('contacted_leads')
                .update({
                    click_count: Number(row.click_count || 0) + 1,
                    clicked_at: nowIso,
                    delivery_status: 'clicked',
                    last_interaction_at: nowIso,
                    engagement_score: Number(row.engagement_score || 0) + 3,
                    evaluation_status: 'pending',
                    last_update_at: nowIso,
                } as any)
                .eq('id', token.contactedId)
                .eq('organization_id', token.organizationId)
                // A signed link counts at most once, including when scanners retry it.
                .is('clicked_at', null);
            if (updateError) throw updateError;
        }
    } catch (error) {
        // Tracking must not prevent a recipient from reaching a valid signed destination.
        console.error('[tracking/click] Failed to record click:', error);
    }

    const response = NextResponse.redirect(token.destination, 302);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
}
