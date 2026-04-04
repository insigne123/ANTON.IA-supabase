import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyUnsubscribeSignature } from "@/lib/unsubscribe-helpers";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { email, u: userId, o: orgId, sig } = body;

        if (!email || !userId || !sig) {
            return NextResponse.json({ error: "Invalid request parameters" }, { status: 400 });
        }

        if (!verifyUnsubscribeSignature(email, userId, orgId, sig)) {
            return NextResponse.json({ error: "Invalid signature or link expired" }, { status: 403 });
        }

        // Initialize Admin Supabase Client
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Insert into blacklist
        const payload: any = {
            email,
            user_id: userId,
            reason: 'User clicked unsubscribe (manual confirmation)'
        };
        if (orgId) payload.organization_id = orgId;

        const { error } = await supabaseAdmin
            .from('unsubscribed_emails')
            .insert(payload);

        if (error) {
            // Duplicate key means already unsubscribed, return success
            if (error.code !== '23505') {
                console.error('Unsubscribe API Error:', error);
                return NextResponse.json({ error: "Server Error" }, { status: 500 });
            }
        }

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error('Unsubscribe POST Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
