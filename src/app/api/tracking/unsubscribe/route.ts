import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUnsubscribeRequest } from "@/lib/unsubscribe-helpers";

export const dynamic = 'force-dynamic';

function adminClient() {
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Preview for the unsubscribe page (Plan 9, PR-19): which address the link is for and who sent the email, so the person
 * knows what they are confirming. Read-only; only a valid signed link gets an answer, and only the organization's name.
 */
export async function GET(req: NextRequest) {
    const resolved = resolveUnsubscribeRequest(Object.fromEntries(req.nextUrl.searchParams));
    if (!resolved) return NextResponse.json({ error: 'INVALID_LINK' }, { status: 400 });
    let senderName: string | null = null;
    if (resolved.orgId) {
        try {
            const { data } = await adminClient().from('organizations').select('name').eq('id', resolved.orgId).maybeSingle();
            senderName = typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : null;
        } catch { senderName = null; }
    }
    return NextResponse.json({ email: resolved.email, senderName }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
    try {
        const contentType = req.headers.get('content-type') || '';
        const postedBody = contentType.includes('application/x-www-form-urlencoded')
            ? Object.fromEntries(new URLSearchParams(await req.text()))
            : await req.json();
        const body = { ...Object.fromEntries(req.nextUrl.searchParams), ...(postedBody || {}) };
        if (body?.['List-Unsubscribe'] && body['List-Unsubscribe'] !== 'One-Click') {
            return NextResponse.json({ error: 'Invalid one-click request' }, { status: 400 });
        }
        const resolved = resolveUnsubscribeRequest(body || {});

        if (!resolved) {
            return NextResponse.json({ error: "Invalid request parameters" }, { status: 400 });
        }

        const { email, userId, orgId } = resolved;

        const supabaseAdmin = adminClient();

        const { error } = await supabaseAdmin.rpc('record_scoped_unsubscribe_v2', {
            p_email: email,
            p_user_id: userId,
            p_organization_id: orgId,
            p_reason: body?.['List-Unsubscribe'] ? 'RFC 8058 one-click unsubscribe' : 'User clicked unsubscribe (manual confirmation)',
        });

        if (error) {
            console.error('Unsubscribe API Error:', error);
            return NextResponse.json({ error: "Server Error" }, { status: 500 });
        }

        return NextResponse.json({ success: true, email });

    } catch (e: any) {
        console.error('Unsubscribe POST Error:', e);
        // Never echo internals to a public page.
        return NextResponse.json({ error: 'UNSUBSCRIBE_FAILED' }, { status: 500 });
    }
}
