import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { classifyReply, extractReplyPreview } from '@/lib/reply-classifier';
import { notificationService } from '@/lib/services/notification-service';

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
    const classification = await classifyReply(text || '');
    const preview = extractReplyPreview(text || '');

    const { data: row } = await supabase
        .from('contacted_leads')
        .select('id, user_id, email, organization_id')
        .eq('id', id)
        .maybeSingle();

    const evalStatus =
        classification.intent === 'negative' || classification.intent === 'unsubscribe'
            ? 'do_not_contact'
            : (classification.intent === 'meeting_request' || classification.intent === 'positive')
                ? 'action_required'
                : 'pending';

    const { error } = await supabase
        .from('contacted_leads')
        .update({
            status: 'replied',
            linkedin_message_status: 'replied',
            last_reply_text: text,
            reply_preview: preview || null,
            reply_intent: classification.intent,
            reply_sentiment: classification.sentiment,
            reply_confidence: classification.confidence,
            reply_summary: classification.summary || null,
            campaign_followup_allowed: classification.shouldContinue,
            campaign_followup_reason: classification.reason || null,
            last_follow_up_at: new Date().toISOString(),
            evaluation_status: evalStatus,
            last_update_at: new Date().toISOString()
        })
        .eq('id', id);

    if ((classification.intent === 'unsubscribe' || classification.intent === 'negative') && row?.email) {
        await supabase
            .from('unsubscribed_emails')
            .upsert({
                email: row.email,
                user_id: row.user_id || null,
                organization_id: row.organization_id || null,
                reason: `reply:${classification.intent}`,
            }, { onConflict: 'email,user_id,organization_id' } as any);
    }

    if (row?.organization_id && (classification.intent === 'meeting_request' || classification.intent === 'positive')) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.antonia.ai';
        const summary = classification.summary || preview || 'Respuesta positiva detectada';
        await notificationService.sendAlert(
            row.organization_id,
            'Respuesta positiva detectada',
            `Lead ${row.email || id} respondió: ${summary}. Revisar: ${appUrl}/contacted/replied`
        );
    }

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, id });
}
