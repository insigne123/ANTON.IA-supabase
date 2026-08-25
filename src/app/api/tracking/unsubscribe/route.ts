import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUnsubscribeRequest } from "@/lib/unsubscribe-helpers";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const resolved = resolveUnsubscribeRequest(body || {});

        if (!resolved) {
            return NextResponse.json({ error: "Invalid request parameters" }, { status: 400 });
        }

        const { email, userId, orgId } = resolved;

        // Initialize Admin Supabase Client
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { error } = await supabaseAdmin.rpc('record_scoped_unsubscribe_v2', {
            p_email: email,
            p_user_id: userId,
            p_organization_id: orgId,
            p_reason: 'User clicked unsubscribe (manual confirmation)',
        });

        if (error) {
            console.error('Unsubscribe API Error:', error);
            return NextResponse.json({ error: "Server Error" }, { status: 500 });
        }

        return NextResponse.json({ success: true, email });

    } catch (e: any) {
        console.error('Unsubscribe POST Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
