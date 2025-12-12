import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const supabase = createRouteHandlerClient({ cookies });
    const body = await request.json();
    const { linkedinThreadUrl, replyText, profileUrl } = body;

    console.log('[API] Reply Detected:', { linkedinThreadUrl, profileUrl });

    // Finding the lead can be tricky if we don't have the exact Thread URL in DB.
    // Strategy:
    // 1. Try to find by `linkedin_thread_url` (exact match).
    // 2. Try to find by `linkedin_url` (Profile URL) if provided.
    // 3. Update status = 'replied'.

    let query = supabase.from('contacted_leads').select('id').eq('provider', 'linkedin');

    if (linkedinThreadUrl) {
        // Or condition? querying by thread first
        const { data: byThread } = await supabase
            .from('contacted_leads')
            .select('id')
            .eq('linkedin_thread_url', linkedinThreadUrl)
            .limit(1)
            .single();

        if (byThread) {
            return await updateLead(supabase, byThread.id, replyText);
        }
    }

    if (profileUrl) {
        // Clean profile URL?
        // Assuming extensions sends clean url like 'https://linkedin.com/in/foo'
        // DB might have 'https://linkedin.com/in/foo/' or w/ query params.
        // For now, strict match or like.
        // Let's try exact match first.
        const { data: byProfile } = await supabase
            .from('contacted_leads')
            .select('id')
            .ilike('linkedin_thread_url', `%${profileUrl}%`) // linkedin_thread_url often = profile in our logic so far
            .limit(1)
            .single();

        if (byProfile) {
            return await updateLead(supabase, byProfile.id, replyText);
        }
    }

    return NextResponse.json({ message: 'Lead not found for reply', matched: false });
}

async function updateLead(supabase: any, id: string, text: string) {
    const { error } = await supabase
        .from('contacted_leads')
        .update({
            status: 'replied',
            linkedin_message_status: 'replied',
            last_reply_text: text,
            last_update_at: new Date().toISOString()
        })
        .eq('id', id);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, id });
}
