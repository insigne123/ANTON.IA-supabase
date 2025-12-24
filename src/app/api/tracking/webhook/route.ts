import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const events = await req.json();
        const supabase = createRouteHandlerClient({ cookies });

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

                await supabase.from('lead_responses').insert({
                    lead_id: leadId,
                    email_message_id: messageId,
                    type: eventType,
                    content: event.text || event.html || null, // For replies
                    created_at: timestamp
                });

                // 2. Update contacted_leads metrics
                const scoreIncrement =
                    eventType === 'open' ? 1 :
                        eventType === 'click' ? 3 :
                            eventType === 'reply' ? 10 : 0;

                // Using rpc or direct update. Direct update is simpler for now but race-condition prone.
                // Ideally we'd have a 'increment_score' function in DB.
                // For now, let's just update last_interaction_at and trigger a re-calc or just basic update

                const { data: current } = await supabase
                    .from('contacted_leads')
                    .select('engagement_score')
                    .eq('lead_id', leadId)
                    .single();

                const newScore = (current?.engagement_score || 0) + scoreIncrement;
                const status = eventType === 'reply' ? 'action_required' : 'pending';

                await supabase
                    .from('contacted_leads')
                    .update({
                        last_interaction_at: timestamp,
                        engagement_score: newScore,
                        evaluation_status: status // If reply, mark for immediate action
                    })
                    .eq('lead_id', leadId);
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Tracking] Webhook error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
