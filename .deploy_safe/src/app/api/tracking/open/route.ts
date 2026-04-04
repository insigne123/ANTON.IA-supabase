import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const leadId = searchParams.get('id');

    // 1x1 Transparent GIF
    const transparentGif = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
    );

    if (!leadId) {
        return new NextResponse(transparentGif, {
            headers: {
                'Content-Type': 'image/gif',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            },
        });
    }

    // Fire and forget update (don't block the image load)
    (async () => {
        try {
            // Use Service Role to bypass RLS for public pixel access
            const supabase = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                {
                    auth: {
                        autoRefreshToken: false,
                        persistSession: false
                    }
                }
            );

            // Record first open + bump engagement score for the latest contact row.
            const nowIso = new Date().toISOString();

            // Support both:
            // - id = leads.id (agent pipeline)
            // - id = contacted_leads.id (legacy campaign followups)
            let { data: row, error: fetchErr } = await supabase
                .from('contacted_leads')
                .select('id, opened_at, engagement_score')
                .eq('lead_id', leadId)
                .order('sent_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!row && !fetchErr) {
                const retry = await supabase
                    .from('contacted_leads')
                    .select('id, opened_at, engagement_score')
                    .eq('id', leadId)
                    .maybeSingle();
                row = retry.data as any;
                fetchErr = retry.error as any;
            }

            if (fetchErr) {
                console.error('[TRACKING] Error fetching contacted_leads row:', fetchErr);
                return;
            }

            if (!row) return;
            if (row.opened_at) return; // already recorded

            const newScore = (row.engagement_score || 0) + 1;

            const { error } = await supabase
                .from('contacted_leads')
                .update({
                    opened_at: nowIso,
                    last_interaction_at: nowIso,
                    engagement_score: newScore,
                    last_update_at: nowIso,
                } as any)
                .eq('id', row.id);

            if (error) {
                console.error('[TRACKING] Error updating read status:', error);
            } else {
                console.log(`[TRACKING] Recorded open for lead ${leadId}`);
            }
        } catch (err) {
            console.error('[TRACKING] Exception:', err);
        }
    })();

    return new NextResponse(transparentGif, {
        headers: {
            'Content-Type': 'image/gif',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
    });
}
