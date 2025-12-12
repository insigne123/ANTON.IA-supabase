import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

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
            // Increment click_count atomic update would be better via RPC, but read-write is acceptable for low volume
            // actually atomic increment: click_count = click_count + 1
            // But simple approach first:
            const { data } = await supabaseAdmin.from('contacted_leads').select('click_count').eq('id', id).single();
            const current = (data?.click_count || 0) + 1;

            await supabaseAdmin
                .from('contacted_leads')
                .update({
                    click_count: current,
                    clicked_at: new Date().toISOString(),
                    last_update_at: new Date().toISOString()
                })
                .eq('id', id);
        } catch (err) {
            console.error("Tracking error:", err);
        }
    }

    // Redirect to the original URL (or fallback to homepage if missing)
    const destination = url || "/";

    // Use 307 Temporary Redirect to preserve method/body if any (though GET here)
    return NextResponse.redirect(destination, 307);
}
