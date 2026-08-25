import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { classifyReply, extractReplyPreview } from '@/lib/reply-classifier';
import { notificationService } from '@/lib/services/notification-service';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { maybeEscalateReplyReviewFromContactedId } from '@/lib/server/antonia-reply-escalation';
import {
    createStableInboundMessageId,
    ingestInboundReply,
} from '@/lib/server/inbound-reply-ingestion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function eventTimestamp(value: unknown) {
    const time = Date.parse(String(value || ''));
    return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const {
            linkedinThreadUrl,
            replyText,
            profileUrl,
            messageId,
            linkedinMessageId,
            eventId,
            receivedAt,
        } = body;
        const text = String(replyText || '').trim();
        if (!text) return NextResponse.json({ error: 'Missing reply text' }, { status: 400 });

        const select = 'id, user_id, email, organization_id, reply_intent, thread_key, thread_id, conversation_id';
        let row: any = null;
        if (linkedinThreadUrl) {
            const { data } = await supabase
                .from('contacted_leads')
                .select(select)
                .eq('provider', 'linkedin')
                .eq('linkedin_thread_url', linkedinThreadUrl)
                .limit(1)
                .maybeSingle();
            row = data;
        }
        if (!row && profileUrl) {
            const { data } = await supabase
                .from('contacted_leads')
                .select(select)
                .eq('provider', 'linkedin')
                .ilike('linkedin_thread_url', `%${profileUrl}%`)
                .limit(1)
                .maybeSingle();
            row = data;
        }
        if (!row) return NextResponse.json({ message: 'Lead not found for reply', matched: false });

        const replyClassification = await classifyReply(text);
        const classification = {
            ...replyClassification,
            evaluationStatus: replyClassification.intent === 'negative' || replyClassification.intent === 'unsubscribe'
                ? 'do_not_contact'
                : replyClassification.intent === 'meeting_request' || replyClassification.intent === 'positive'
                    ? 'action_required'
                    : 'pending',
        };
        const preview = extractReplyPreview(text);
        const explicitMessageId = String(messageId || linkedinMessageId || eventId || '').trim();
        const threadIdentity = String(linkedinThreadUrl || profileUrl || '').trim();
        const resolvedMessageId = explicitMessageId || createStableInboundMessageId({
            provider: 'linkedin',
            contactedId: row.id,
            content: [threadIdentity, text].join('\u001f'),
        });
        const ingestion = await ingestInboundReply(getSupabaseAdminClient(), {
            contactedId: row.id,
            recipientEmail: row.email || null,
            provider: 'linkedin',
            messageId: resolvedMessageId,
            eventType: 'reply',
            eventSource: 'scheduler_reply',
            eventAt: eventTimestamp(receivedAt),
            threadKey: threadIdentity ? `linkedin:${threadIdentity}` : row.thread_key || null,
            threadId: threadIdentity || row.thread_id || null,
            conversationId: String(profileUrl || '').trim() || row.conversation_id || null,
            content: text,
            preview: preview || null,
            classification,
        });

        if (!ingestion.inserted) {
            return NextResponse.json({ success: true, id: row.id, duplicate: true });
        }

        if (!row.reply_intent && row.organization_id && (classification.intent === 'meeting_request' || classification.intent === 'positive')) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.antonia.ai';
            const summary = classification.summary || preview || 'Respuesta positiva detectada';
            await notificationService.sendAlert(
                row.organization_id,
                'Respuesta positiva detectada',
                `Lead ${row.email || row.id} respondió: ${summary}. Revisar: ${appUrl}/contacted/replied`,
            );
        }

        if (row.organization_id && classification.intent !== 'negative' && classification.intent !== 'unsubscribe' && classification.intent !== 'delivery_failure') {
            await maybeEscalateReplyReviewFromContactedId({
                supabase: getSupabaseAdminClient(),
                organizationId: row.organization_id,
                userId: row.user_id,
                contactedId: row.id,
                rawReply: text,
            }).catch((error) => {
                console.warn('[scheduler/reply] escalation failed:', error);
            });
        }

        return NextResponse.json({ success: true, id: row.id });
    } catch (error: any) {
        console.error('[scheduler/reply] error:', error);
        return NextResponse.json({ error: error?.message || 'Unable to ingest reply' }, { status: 500 });
    }
}
