import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

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

            // Update opened_at only if it's currently null (track first open)
            // OR update list of opens if we wanted to support multiple
            // For now, simple logic: set opened_at if null
            const { error } = await supabase
                .from('contacted_leads')
                .update({
                    opened_at: new Date().toISOString(),
                    // Optionally increment open count if column existed, but we stick to schema
                })
                .eq('lead_id', leadId)
                .is('opened_at', null); // Only update if not already opened

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
