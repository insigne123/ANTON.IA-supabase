import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { resolveTrackingToken } from '@/lib/server/tracking-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    // 1x1 Transparent GIF
    const transparentGif = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
    );

    const token = resolveTrackingToken(req.nextUrl.searchParams.get('t'), 'open');
    if (!token) {
        return new NextResponse(transparentGif, {
            headers: {
                'Content-Type': 'image/gif',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Referrer-Policy': 'no-referrer',
            },
        });
    }

    try {
        const supabase = getSupabaseAdminClient();
        const nowIso = new Date().toISOString();
        const { data: row, error: fetchError } = await supabase
            .from('contacted_leads')
            .select('id, opened_at, engagement_score')
            .eq('id', token.contactedId)
            .eq('organization_id', token.organizationId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (row && !row.opened_at) {
            const { error: updateError } = await supabase
                .from('contacted_leads')
                .update({
                    opened_at: nowIso,
                    delivery_status: 'opened',
                    last_interaction_at: nowIso,
                    engagement_score: Number(row.engagement_score || 0) + 1,
                    last_update_at: nowIso,
                } as any)
                .eq('id', token.contactedId)
                .eq('organization_id', token.organizationId)
                .is('opened_at', null);
            if (updateError) throw updateError;
        }
    } catch (err) {
        console.error('[tracking/open] Failed to record open:', err);
    }

    return new NextResponse(transparentGif, {
        headers: {
            'Content-Type': 'image/gif',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Referrer-Policy': 'no-referrer',
        },
    });
}
