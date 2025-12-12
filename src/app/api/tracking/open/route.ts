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
        // Await the update... (existing code)
        try {
            await supabaseAdmin
                .from('contacted_leads')
                .update({
                    opened_at: new Date().toISOString(),
                    last_update_at: new Date().toISOString(),
                })
                .eq('id', id);
        } catch (err) {
            console.error("Tracking Open error:", err);
        }

        const redirectUrl = searchParams.get("redirect");
        if (redirectUrl) {
            // Validate URL to prevent open redirect vulnerabilities (optional but good practice)
            // For now, assuming relatively trusted internal usage, but we should at least check http protocol
            try {
                const urlObj = new URL(redirectUrl);
                if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
                    return NextResponse.redirect(redirectUrl, 307); // 307 ensures method preservation if relevant, though GET is just GET
                }
            } catch (e) {
                // Invalid URL, fall through to pixel
            }
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
