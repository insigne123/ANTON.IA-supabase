import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildSuggestedMeetingReply } from '@/lib/antonia-autopilot';
import { classifyReply, extractReplyPreview } from '@/lib/reply-classifier';
import { detectDeliveryFailure } from '@/lib/delivery-failure-detector';
import { notificationService } from '@/lib/services/notification-service';
import { syncLeadAutopilotToCrm } from '@/lib/server/crm-autopilot';
import { createAntoniaException } from '@/lib/server/antonia-exceptions';
import { maybeEscalateReplyReviewFromContactedId } from '@/lib/server/antonia-reply-escalation';
import { buildThreadKey, deriveLifecycleState, safeInsertEmailEvent } from '@/lib/email-observability';

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

function normalizeMessageId(value: unknown) {
    return String(value || '').trim().replace(/^<|>$/g, '');
}

async function resolveContactedLeadForEvent(params: {
    supabase: any;
    eventType: string;
    contactedId?: string | null;
    leadId?: string | null;
    messageId?: string | null;
    internetMessageId?: string | null;
    threadId?: string | null;
    conversationId?: string | null;
}) {
    const { supabase, eventType } = params;
    const select = 'id, user_id, email, organization_id, mission_id, engagement_score, click_count, opened_at, clicked_at, replied_at, campaign_followup_allowed, reply_intent, name, company, role, lead_id, message_id, internet_message_id, thread_id, conversation_id';
    const attempts: Array<{ field: string; value?: string | null }> = [
        { field: 'id', value: String(params.contactedId || '').trim() || null },
        { field: 'message_id', value: normalizeMessageId(params.messageId) || null },
        { field: 'internet_message_id', value: normalizeMessageId(params.internetMessageId) || null },
        { field: 'thread_id', value: String(params.threadId || '').trim() || null },
        { field: 'conversation_id', value: String(params.conversationId || '').trim() || null },
    ];

    for (const attempt of attempts) {
        if (!attempt.value) continue;
        const { data } = await supabase
            .from('contacted_leads')
            .select(select)
            .eq(attempt.field, attempt.value)
            .order('sent_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (data) return data;
    }

    const leadId = String(params.leadId || '').trim();
    if (!leadId) return null;

    const { data: rows } = await supabase
        .from('contacted_leads')
        .select(select)
        .eq('lead_id', leadId)
        .order('sent_at', { ascending: false })
        .limit(2);

    const list = rows || [];
    if (list.length <= 1) return list[0] || null;

    if (eventType === 'reply') {
        console.warn('[Tracking] Ambiguous reply event; skipping fallback by lead_id', { leadId, count: list.length });
        return null;
    }

    return list[0] || null;
}

function fallbackFailureFromEvent(type: string, rawText: string) {
    if (type === 'deferred') {
        return {
            deliveryStatus: 'soft_bounced' as const,
            bounceCategory: 'temporary_failure' as const,
            bounceReason: rawText || 'La entrega fue aplazada temporalmente.',
            evaluationStatus: 'action_required' as const,
            campaignFollowupReason: 'temporary_failure',
        };
    }

    if (type === 'blocked') {
        return {
            deliveryStatus: 'soft_bounced' as const,
            bounceCategory: 'policy_block' as const,
            bounceReason: rawText || 'El mensaje fue bloqueado por politica o reputacion.',
            evaluationStatus: 'action_required' as const,
            campaignFollowupReason: 'policy_block',
        };
    }

    return {
        deliveryStatus: 'bounced' as const,
        bounceCategory: 'generic' as const,
        bounceReason: rawText || 'Se detecto un rebote o falla de entrega.',
        evaluationStatus: 'do_not_contact' as const,
        campaignFollowupReason: 'generic_delivery_failure',
    };
}

async function updateContactedLead(supabase: any, contactedId: string | undefined, updateData: any) {
    if (!contactedId) return;

    let { error: updateError } = await supabase
        .from('contacted_leads')
        .update(updateData)
        .eq('id', contactedId);

    if (updateError && hasReplyTraceColumnError(updateError)) {
        const { error: retryError } = await supabase
            .from('contacted_leads')
            .update(stripReplyTraceFields(updateData))
            .eq('id', contactedId);
        updateError = retryError;
    }

    if (updateError) {
        console.error('[Tracking] Error updating contacted_leads:', updateError);
    }
}

export async function POST(req: Request) {
    try {
        const secret = process.env.TRACKING_WEBHOOK_SECRET;
        if (!secret) {
            return NextResponse.json({ error: 'TRACKING_WEBHOOK_SECRET not configured' }, { status: 503 });
        }

        const got = req.headers.get('x-webhook-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
        if (got !== secret) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const events = await req.json();
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } }
        );

        const eventList = Array.isArray(events) ? events : [events];

        for (const event of eventList) {
            const type = String(event.event || '').toLowerCase();
            const email = event.email;
            const timestamp = event.timestamp
                ? new Date(Number(event.timestamp) * 1000).toISOString()
                : new Date().toISOString();
            const leadId = event.leadId || event.custom_args?.leadId;
            const messageId = normalizeMessageId(event.sg_message_id || event.messageId || event.custom_args?.messageId || event.headers?.['message-id']);
            const internetMessageId = normalizeMessageId(event.internetMessageId || event.custom_args?.internetMessageId || event.headers?.['in-reply-to'] || event.headers?.['references']);
            const threadId = String(event.threadId || event.custom_args?.threadId || event.thread_id || '').trim() || null;
            const conversationId = String(event.conversationId || event.custom_args?.conversationId || event.conversation_id || '').trim() || null;
            const contactedId = String(event.contactedId || event.custom_args?.contactedId || '').trim() || null;

            if (!leadId) {
                console.log('[Tracking] Event skipped: No leadId found', event);
                continue;
            }

            console.log(`[Tracking] Processing ${type} for lead ${leadId}`);

            if (!['open', 'click', 'reply', 'inbound', 'bounce', 'blocked', 'dropped', 'deferred', 'delivered'].includes(type)) {
                continue;
            }

            const eventType = type === 'inbound' ? 'reply' : type;
            const contacted = await resolveContactedLeadForEvent({
                supabase,
                eventType,
                contactedId,
                leadId,
                messageId,
                internetMessageId,
                threadId,
                conversationId,
            });

            if (!contacted) {
                console.warn('[Tracking] No contacted_lead matched event', { eventType, leadId, messageId, threadId, conversationId });
                continue;
            }

            const orgId = (contacted as any)?.organization_id ?? null;
            const missionId = (contacted as any)?.mission_id ?? null;
            const rawEventText = [event.reason, event.response, event.description, event.text, event.html].filter(Boolean).join('\n');
            const threadKey = buildThreadKey({
                provider: (contacted as any)?.provider,
                threadId: threadId || (contacted as any)?.thread_id,
                conversationId: conversationId || (contacted as any)?.conversation_id,
                internetMessageId: internetMessageId || (contacted as any)?.internet_message_id,
                messageId: messageId || (contacted as any)?.message_id,
            });

            await safeInsertEmailEvent(supabase, {
                organization_id: orgId,
                mission_id: missionId,
                contacted_id: (contacted as any)?.id || null,
                lead_id: leadId,
                provider: (contacted as any)?.provider || null,
                event_type: eventType,
                event_source: 'tracking_webhook',
                event_at: timestamp,
                thread_key: threadKey,
                message_id: messageId || null,
                internet_message_id: internetMessageId || null,
                meta: {
                    email,
                    replyIntent: event.replyIntent || null,
                    summary: String(rawEventText || '').slice(0, 500),
                },
            });

            await supabase.from('lead_responses').insert({
                lead_id: leadId,
                contacted_id: (contacted as any)?.id || null,
                organization_id: orgId,
                mission_id: missionId,
                email_message_id: messageId,
                type: eventType,
                content: rawEventText || null,
                created_at: timestamp,
            } as any);

            const scoreIncrement =
                eventType === 'open' ? 1 :
                    eventType === 'click' ? 3 :
                        eventType === 'reply' ? 10 : 0;

            const currentScore = (contacted as any)?.engagement_score || 0;
            const currentClickCount = (contacted as any)?.click_count || 0;
            const newScore = currentScore + scoreIncrement;
            const updateData: any = {
                last_interaction_at: timestamp,
                engagement_score: newScore,
                evaluation_status: eventType === 'reply' ? 'action_required' : 'pending',
                last_update_at: timestamp,
                thread_key: threadKey,
                last_event_type: eventType,
                last_event_at: timestamp,
                lifecycle_state: deriveLifecycleState((contacted as any)?.lifecycle_state || (contacted as any)?.status, eventType),
            };

            if (eventType === 'delivered') {
                updateData.delivered_at = timestamp;
                updateData.delivery_status = 'delivered';
            }

            if (eventType === 'open' && !(contacted as any)?.opened_at) {
                updateData.opened_at = timestamp;
                updateData.delivery_status = 'opened';
            }

            if (eventType === 'click') {
                updateData.clicked_at = timestamp;
                updateData.click_count = currentClickCount + 1;
                updateData.delivery_status = 'clicked';
            }

            if (['bounce', 'blocked', 'dropped', 'deferred'].includes(eventType)) {
                const detected = detectDeliveryFailure({
                    subject: event.subject || event.headers?.subject,
                    from: event.from || event.sender || event.headers?.from,
                    text: rawEventText,
                    html: event.html,
                });
                const failure = detected || fallbackFailureFromEvent(eventType, rawEventText);
                updateData.status = 'failed';
                updateData.reply_intent = 'delivery_failure';
                updateData.reply_sentiment = 'neutral';
                updateData.reply_confidence = 0.98;
                updateData.reply_summary = failure.bounceReason;
                updateData.campaign_followup_allowed = false;
                updateData.campaign_followup_reason = failure.campaignFollowupReason;
                updateData.evaluation_status = failure.evaluationStatus;
                updateData.delivery_status = failure.deliveryStatus;
                updateData.bounced_at = timestamp;
                updateData.bounce_category = failure.bounceCategory;
                updateData.bounce_reason = failure.bounceReason;
                if (orgId && leadId) {
                    await syncLeadAutopilotToCrm(supabase, {
                        organizationId: orgId,
                        leadId,
                        stage: 'closed_lost',
                        notes: failure.bounceReason || 'Entrega fallida',
                        nextAction: 'Revisar email, dominio o canal antes de volver a contactar',
                        nextActionType: 'delivery_failure_review',
                        nextActionDueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                        autopilotStatus: 'delivery_failure',
                        lastAutopilotEvent: eventType,
                    });
                }
                await updateContactedLead(supabase, (contacted as any)?.id, updateData);
                continue;
            }

            if (orgId && leadId) {
                if (eventType === 'delivered') {
                    await syncLeadAutopilotToCrm(supabase, {
                        organizationId: orgId,
                        leadId,
                        stage: 'contacted',
                        notes: 'Correo entregado correctamente',
                        nextAction: 'Esperar apertura o respuesta del lead',
                        nextActionType: 'wait_for_reply',
                        nextActionDueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                        autopilotStatus: 'delivered',
                        lastAutopilotEvent: 'delivered',
                    });
                }

                if (eventType === 'open') {
                    await syncLeadAutopilotToCrm(supabase, {
                        organizationId: orgId,
                        leadId,
                        stage: 'contacted',
                        notes: 'Lead abrio el correo',
                        nextAction: 'Monitorear si responde o hace click antes de follow-up',
                        nextActionType: 'opened_wait_reply',
                        nextActionDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
                        autopilotStatus: 'opened',
                        lastAutopilotEvent: 'open',
                    });
                }

                if (eventType === 'click') {
                    await syncLeadAutopilotToCrm(supabase, {
                        organizationId: orgId,
                        leadId,
                        stage: 'engaged',
                        notes: 'Lead hizo click en el contenido enviado',
                        nextAction: 'Priorizar seguimiento porque ya mostro interes',
                        nextActionType: 'clicked_followup',
                        nextActionDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                        autopilotStatus: 'clicked',
                        lastAutopilotEvent: 'click',
                    });
                }
            }

            if (eventType === 'reply') {
                updateData.replied_at = timestamp;
                updateData.status = 'replied';
                updateData.delivery_status = 'replied';
                updateData.last_follow_up_at = timestamp;
                updateData.reply_message_id = messageId || null;
                updateData.reply_subject = event.subject || event.headers?.subject || null;

                const replyContent = event.text || event.html || '';
                const preview = extractReplyPreview(replyContent);
                updateData.reply_preview = preview || null;
                updateData.reply_snippet = preview || null;
                updateData.last_reply_text = replyContent ? String(replyContent).slice(0, 4000) : null;

                try {
                    const detectedFailure = detectDeliveryFailure({
                        subject: event.subject || event.headers?.subject,
                        from: event.from || event.sender || event.headers?.from || email,
                        text: event.text || '',
                        html: event.html || '',
                    });

                    if (detectedFailure) {
                        updateData.status = 'failed';
                        updateData.replied_at = null;
                        updateData.delivery_status = detectedFailure.deliveryStatus;
                        updateData.bounced_at = timestamp;
                        updateData.bounce_category = detectedFailure.bounceCategory;
                        updateData.bounce_reason = detectedFailure.bounceReason;
                        updateData.reply_intent = detectedFailure.replyIntent;
                        updateData.reply_sentiment = 'neutral';
                        updateData.reply_confidence = 0.98;
                        updateData.reply_summary = detectedFailure.bounceReason;
                        updateData.campaign_followup_allowed = false;
                        updateData.campaign_followup_reason = detectedFailure.campaignFollowupReason;
                        updateData.evaluation_status = detectedFailure.evaluationStatus;
                    } else {
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
                                    user_id: (contacted as any)?.user_id || null,
                                    organization_id: orgId,
                                    reason: `reply:${classification.intent}`,
                                }, { onConflict: 'email,user_id,organization_id' } as any);
                        }

                        const leadSummary = {
                            id: leadId,
                            name: (contacted as any)?.name || null,
                            fullName: (contacted as any)?.name || null,
                            email: (contacted as any)?.email || email || null,
                            company: (contacted as any)?.company || null,
                            companyName: (contacted as any)?.company || null,
                            title: (contacted as any)?.role || null,
                        };

                            if (shouldNotify && orgId && (classification.intent === 'meeting_request' || classification.intent === 'positive')) {
                            const { data: autopilotConfig } = await supabase
                                .from('antonia_config')
                                .select('booking_link, meeting_instructions')
                                .eq('organization_id', orgId)
                                .maybeSingle();

                            const suggestedReply = buildSuggestedMeetingReply({
                                leadName: leadSummary.fullName,
                                companyName: leadSummary.companyName,
                                bookingLink: autopilotConfig?.booking_link,
                                meetingInstructions: autopilotConfig?.meeting_instructions,
                            });

                            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.antonia.ai';
                            const summary = classification.summary || preview || 'Respuesta positiva detectada';
                            const leadEmail = (contacted as any)?.email || leadId;
                            await notificationService.sendAlert(
                                orgId,
                                'Respuesta positiva detectada',
                                `Lead ${leadEmail} respondió: ${summary}. Revisar: ${appUrl}/contacted/replied`
                            );

                            await createAntoniaException(supabase, {
                                organizationId: orgId,
                                missionId,
                                leadId,
                                category: 'positive_reply',
                                severity: classification.intent === 'meeting_request' ? 'critical' : 'high',
                                title: classification.intent === 'meeting_request' ? 'Lead solicitó reunión' : 'Lead con respuesta positiva',
                                description: summary,
                                dedupeKey: `positive_reply_${leadId}`,
                                payload: {
                                    lead: leadSummary,
                                    classification,
                                    preview,
                                    suggestedReply,
                                },
                            });

                                await syncLeadAutopilotToCrm(supabase, {
                                    organizationId: orgId,
                                    leadId,
                                stage: classification.intent === 'meeting_request' ? 'meeting' : 'engaged',
                                notes: summary,
                                nextAction: classification.intent === 'meeting_request'
                                    ? 'Confirmar reunion y preparar contexto comercial'
                                    : 'Responder rapido y proponer horario de reunion',
                                nextActionType: classification.intent === 'meeting_request' ? 'meeting_handoff' : 'hot_reply_followup',
                                nextActionDueAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                                autopilotStatus: classification.intent === 'meeting_request' ? 'meeting_requested' : 'positive_reply',
                                lastAutopilotEvent: classification.intent,
                                    meetingLink: autopilotConfig?.booking_link || null,
                                });
                            }

                            if (orgId && (contacted as any)?.id && classification.intent !== 'negative' && classification.intent !== 'unsubscribe' && classification.intent !== 'delivery_failure') {
                                await maybeEscalateReplyReviewFromContactedId({
                                    supabase,
                                    organizationId: orgId,
                                    userId: (contacted as any)?.user_id,
                                    contactedId: (contacted as any).id,
                                    rawReply: replyContent,
                                    replySubject: event.subject || event.headers?.subject || null,
                                }).catch((error) => {
                                    console.warn('[Tracking] reply escalation failed:', error);
                                });
                            }

                            if (orgId && missionId && (classification.intent === 'unsubscribe' || classification.intent === 'negative')) {
                            const { data: orgConfig } = await supabase
                                .from('antonia_config')
                                .select('pause_on_negative_reply')
                                .eq('organization_id', orgId)
                                .maybeSingle();

                            await createAntoniaException(supabase, {
                                organizationId: orgId,
                                missionId,
                                leadId,
                                category: 'negative_reply_guardrail',
                                severity: 'high',
                                title: 'Reply negativo detectado',
                                description: classification.summary || preview || 'ANTONIA detuvo seguimiento por señal negativa.',
                                dedupeKey: `negative_reply_${leadId}`,
                                payload: { lead: leadSummary, classification, preview },
                            });

                            await syncLeadAutopilotToCrm(supabase, {
                                organizationId: orgId,
                                leadId,
                                stage: 'closed_lost',
                                notes: classification.summary || preview || 'Respuesta negativa detectada',
                                nextAction: 'Detener secuencia y revisar motivo de rechazo',
                                nextActionType: 'negative_reply_review',
                                nextActionDueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                                autopilotStatus: 'negative_reply',
                                lastAutopilotEvent: classification.intent,
                            });

                            if (orgConfig?.pause_on_negative_reply) {
                                await supabase
                                    .from('antonia_missions')
                                    .update({ status: 'paused', updated_at: new Date().toISOString() })
                                    .eq('id', missionId)
                                    .eq('status', 'active');

                                await supabase
                                    .from('antonia_tasks')
                                    .update({
                                        status: 'completed',
                                        result: {
                                            skipped: true,
                                            reason: 'mission_paused',
                                            source: 'negative_reply_guardrail',
                                        },
                                        error_message: null,
                                        updated_at: new Date().toISOString(),
                                    } as any)
                                    .eq('mission_id', missionId)
                                    .eq('status', 'pending')
                                    .in('type', ['GENERATE_CAMPAIGN', 'SEARCH', 'ENRICH', 'INVESTIGATE', 'CONTACT', 'CONTACT_INITIAL', 'CONTACT_CAMPAIGN']);
                            }
                        }
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

            await updateContactedLead(supabase, (contacted as any)?.id, updateData);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Tracking] Webhook error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
