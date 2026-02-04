import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const url = searchParams.get("url");

    if (id && url) {
        // Use Service Role to bypass RLS for tracking updates
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Await the update to ensure it completes before the response is sent
        try {
            const nowIso = new Date().toISOString();

            // Support both:
            // - id = contacted_leads.id (legacy followups)
            // - id = leads.id (agent pipeline)
            let row: any = null;

            const byId = await supabaseAdmin
                .from('contacted_leads')
                .select('id, click_count, engagement_score')
                .eq('id', id)
                .maybeSingle();
            if (byId.data) {
                row = byId.data;
            } else {
                const byLead = await supabaseAdmin
                    .from('contacted_leads')
                    .select('id, click_count, engagement_score')
                    .eq('lead_id', id)
                    .order('sent_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                row = byLead.data;
            }

            if (row?.id) {
                const currentClicks = (row.click_count || 0) + 1;
                const currentScore = row.engagement_score || 0;
                const newScore = currentScore + 3;

                await supabaseAdmin
                    .from('contacted_leads')
                    .update({
                        click_count: currentClicks,
                        clicked_at: nowIso,
                        last_interaction_at: nowIso,
                        engagement_score: newScore,
                        evaluation_status: 'pending',
                        last_update_at: nowIso,
                    } as any)
                    .eq('id', row.id);
            }
        } catch (err) {
            console.error("Tracking error:", err);
        }
    }

    // Redirect to the original URL (or fallback to homepage if missing)
    const destination = url || "/";

    // Use 307 Temporary Redirect to preserve method/body if any (though GET here)
    return NextResponse.redirect(destination, 307);
}
