import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { classifyReply, extractReplyPreview } from '@/lib/reply-classifier';
import { notificationService } from '@/lib/services/notification-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function stripReplyTraceFields(updateData: any) {
    const copy = { ...updateData };
    delete copy.reply_message_id;
    delete copy.reply_subject;
    delete copy.reply_snippet;
    return copy;
}

function hasReplyTraceColumnError(error: any) {
    const text = String(error?.message || error?.details || '').toLowerCase();
    return text.includes('reply_message_id') || text.includes('reply_subject') || text.includes('reply_snippet');
}

export async function POST(req: Request) {
    try {
        // Optional shared-secret protection (recommended in production)
        const secret = process.env.TRACKING_WEBHOOK_SECRET;
        if (secret) {
            const got = req.headers.get('x-webhook-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
            if (got !== secret) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        const events = await req.json();
        // Webhooks are server-to-server: use service role (no cookies/session)
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } }
        );

        // Handle both single event object and array of events (SendGrid sends array, Mailgun sends object)
        const eventList = Array.isArray(events) ? events : [events];

        for (const event of eventList) {
            // Normalize event data
            // Note: This logic depends on the provider (SendGrid, Mailgun, etc.)
            // Assuming a generic structure for now, adaptable to SendGrid
            const type = event.event; // open, click, etc.
            const email = event.email;
            const timestamp = new Date(event.timestamp * 1000).toISOString();

            // Metadata passed in the email headers/custom args
            // We need to ensure we send 'leadId' in custom args when sending emails
            const leadId = event.leadId || event.custom_args?.leadId;
            const messageId = event.sg_message_id || event.messageId;

            if (!leadId) {
                console.log('[Tracking] Event skipped: No leadId found', event);
                continue;
            }

            console.log(`[Tracking] Processing ${type} for lead ${leadId}`);

            // 1. Record the response/interaction
            if (['open', 'click', 'reply'].includes(type) || type === 'inbound') {
                // Map 'inbound' (Mailgun) to 'reply'
                const eventType = type === 'inbound' ? 'reply' : type;

                // Fetch latest contacted row for this lead to attach org/mission and update safely
                const { data: contacted } = await supabase
                    .from('contacted_leads')
                    .select('id, user_id, email, organization_id, mission_id, engagement_score, click_count, opened_at, clicked_at, replied_at, campaign_followup_allowed')
                    .eq('lead_id', leadId)
                    .order('sent_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const orgId = (contacted as any)?.organization_id ?? null;
                const missionId = (contacted as any)?.mission_id ?? null;

                await supabase.from('lead_responses').insert({
                    lead_id: leadId,
                    organization_id: orgId,
                    mission_id: missionId,
                    email_message_id: messageId,
                    type: eventType,
                    content: event.text || event.html || null, // For replies
                    created_at: timestamp
                } as any);

                // 2. Update contacted_leads metrics
                const scoreIncrement =
                    eventType === 'open' ? 1 :
                        eventType === 'click' ? 3 :
                            eventType === 'reply' ? 10 : 0;

                // Using rpc or direct update. Direct update is simpler for now but race-condition prone.
                // Ideally we'd have a 'increment_score' function in DB.
                // For now, let's just update last_interaction_at and trigger a re-calc or just basic update

                const currentScore = (contacted as any)?.engagement_score || 0;
                const currentClickCount = (contacted as any)?.click_count || 0;
                const newScore = currentScore + scoreIncrement;
                const evalStatus = eventType === 'reply' ? 'action_required' : 'pending';

                const updateData: any = {
                    last_interaction_at: timestamp,
                    engagement_score: newScore,
                    evaluation_status: evalStatus,
                    last_update_at: timestamp,
                };
                if (eventType === 'open' && !(contacted as any)?.opened_at) updateData.opened_at = timestamp;
                if (eventType === 'click') {
                    updateData.clicked_at = timestamp;
                    updateData.click_count = currentClickCount + 1;
                }
                if (eventType === 'reply') {
                    updateData.replied_at = timestamp;
                    updateData.status = 'replied';
                    updateData.last_follow_up_at = timestamp;
                    updateData.reply_message_id = messageId || null;
                    updateData.reply_subject = event.subject || event.headers?.subject || null;

                    const replyContent = event.text || event.html || '';
                    const preview = extractReplyPreview(replyContent);
                    updateData.reply_preview = preview || null;
                    updateData.reply_snippet = preview || null;
                    updateData.last_reply_text = replyContent ? String(replyContent).slice(0, 4000) : null;

                    try {
                        const shouldNotify = !(contacted as any)?.reply_intent;
                        const classification = await classifyReply(replyContent || '');
                        updateData.reply_intent = classification.intent;
                        updateData.reply_sentiment = classification.sentiment;
                        updateData.reply_confidence = classification.confidence;
                        updateData.reply_summary = classification.summary || null;
                        updateData.campaign_followup_allowed = classification.shouldContinue;
                        updateData.campaign_followup_reason = classification.reason || null;

                        if (!classification.shouldContinue) {
                            updateData.evaluation_status = classification.intent === 'negative' || classification.intent === 'unsubscribe'
                                ? 'do_not_contact'
                                : 'action_required';
                        }

                        if ((classification.intent === 'unsubscribe' || classification.intent === 'negative') && (contacted as any)?.email) {
                            await supabase
                                .from('unsubscribed_emails')
                                .upsert({
                                    email: (contacted as any).email,
                                    user_id: (contacted as any).user_id || null,
                                    organization_id: orgId,
                                    reason: `reply:${classification.intent}`,
                                }, { onConflict: 'email,user_id,organization_id' } as any);
                        }

                        if (shouldNotify && orgId && (classification.intent === 'meeting_request' || classification.intent === 'positive')) {
                            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.antonia.ai';
                            const summary = classification.summary || preview || 'Respuesta positiva detectada';
                            const leadEmail = (contacted as any)?.email || leadId;
                            await notificationService.sendAlert(
                                orgId,
                                'Respuesta positiva detectada',
                                `Lead ${leadEmail} respondió: ${summary}. Revisar: ${appUrl}/contacted/replied`
                            );
                        }
                    } catch (err) {
                        updateData.reply_intent = 'unknown';
                        updateData.reply_sentiment = 'neutral';
                        updateData.reply_confidence = 0.2;
                        updateData.reply_summary = null;
                        updateData.campaign_followup_allowed = false;
                        updateData.campaign_followup_reason = 'classifier_error';
                    }
                }

                if ((contacted as any)?.id) {
                    let { error: updateError } = await supabase
                        .from('contacted_leads')
                        .update(updateData)
                        .eq('id', (contacted as any).id);

                    if (updateError && hasReplyTraceColumnError(updateError)) {
                        const { error: retryError } = await supabase
                            .from('contacted_leads')
                            .update(stripReplyTraceFields(updateData))
                            .eq('id', (contacted as any).id);
                        updateError = retryError;
                    }

                    if (updateError) {
                        console.error('[Tracking] Error updating contacted_leads:', updateError);
                    }
                }
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Tracking] Webhook error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
