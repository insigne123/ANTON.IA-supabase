import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
        // Use Service Role to bypass RLS for tracking updates
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Await the update to ensure it completes before the response is sent (Serverless execution model)
        try {
            await supabaseAdmin
                .from('contacted_leads')
                .update({
                    // status: 'opened', // REMOVED: Violates DB constraint. We only track opened_at.
                    opened_at: new Date().toISOString(),
                    last_update_at: new Date().toISOString(),
                })
                .eq('id', id);
        } catch (err) {
            console.error("Tracking Open error:", err);
        }

        // Transparent 1x1 PNG pixel
        const pixel = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            "base64"
        );

        return new NextResponse(pixel, {
            headers: {
                "Content-Type": "image/png",
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
            },
        });
    }
}
