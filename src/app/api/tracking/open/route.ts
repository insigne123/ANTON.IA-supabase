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

        // DEBUG MODE: Return JSON to see what is failing
        try {
            const result = await supabaseAdmin
                .from('contacted_leads')
                .update({
                    status: 'opened',
                    opened_at: new Date().toISOString(),
                    last_update_at: new Date().toISOString(),
                })
                .eq('id', id)
                .select(); // Select to check if row was found

            if (result.error) throw result.error;
            if (result.data.length === 0) throw new Error("Row not found (ID mismatch)");

            return NextResponse.json({ success: true, updated: result.data });

        } catch (err: any) {
            return NextResponse.json({ success: false, error: err.message || err }, { status: 500 });
        }
    }
}
