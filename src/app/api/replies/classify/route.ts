import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { classifyReply, extractReplyPreview, type ReplyClassification } from '@/lib/reply-classifier';
import { detectDeliveryFailure } from '@/lib/delivery-failure-detector';
import { notificationService } from '@/lib/services/notification-service';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { maybeEscalateReplyReviewFromContactedId } from '@/lib/server/antonia-reply-escalation';
import { shouldGloballySuppressReply } from '@/lib/contact-history-guard';
import {
  createStableInboundMessageId,
  ingestInboundReply,
  recordInboundUnsubscribe,
} from '@/lib/server/inbound-reply-ingestion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function eventTimestamp(value: unknown) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      contactedId,
      text,
      subject,
      from,
      html,
      messageId,
      internetMessageId,
      threadKey,
      threadId,
      conversationId,
      eventAt,
    } = await req.json();
    if (!contactedId || (!text && !html)) {
      return NextResponse.json({ error: 'Missing contactedId or reply content' }, { status: 400 });
    }

    const { data: row } = await supabase
      .from('contacted_leads')
      .select('id, user_id, email, organization_id, reply_intent, provider, thread_key, thread_id, conversation_id')
      .eq('id', contactedId)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({ error: 'Contacted lead not found' }, { status: 404 });
    }

    const rawText = String(text || html || '');
    const preview = extractReplyPreview(rawText || String(html || ''));
    const deliveryFailure = detectDeliveryFailure({
      subject: String(subject || ''),
      from: String(from || ''),
      text: rawText,
      html: String(html || ''),
    });

    const isDeliveryFailure = Boolean(deliveryFailure);
    const failure = deliveryFailure;
    let replyClassification: ReplyClassification | null = null;
    if (!isDeliveryFailure) {
      replyClassification = await classifyReply(rawText);
    }
    const classification = isDeliveryFailure
      ? {
          intent: failure!.replyIntent,
          sentiment: 'neutral',
          confidence: 0.98,
          summary: failure!.bounceReason,
          reason: failure!.campaignFollowupReason,
          shouldContinue: false,
          evaluationStatus: failure!.evaluationStatus,
          deliveryStatus: failure!.deliveryStatus,
          bounceCategory: failure!.bounceCategory,
          bounceReason: failure!.bounceReason,
        }
      : {
          ...replyClassification!,
          evaluationStatus: replyClassification!.intent === 'negative' || replyClassification!.intent === 'unsubscribe'
            ? 'do_not_contact'
            : replyClassification!.intent === 'meeting_request' || replyClassification!.intent === 'positive'
              ? 'action_required'
              : 'pending',
        };
    const intent = classification.intent;
    const provider = String(row.provider || 'manual').trim() || 'manual';
    const receivedAt = eventTimestamp(eventAt);
    const resolvedMessageId = String(messageId || '').trim() || createStableInboundMessageId({
      provider,
      contactedId: row.id,
      sourceIdentity: String(internetMessageId || '').trim() || null,
      content: [threadKey || row.thread_key, threadId || row.thread_id, conversationId || row.conversation_id, rawText].join('\u001f'),
    });
    const ingestion = await ingestInboundReply(getSupabaseAdminClient(), {
      contactedId: row.id,
      recipientEmail: row.email || null,
      provider,
      messageId: resolvedMessageId,
      internetMessageId: String(internetMessageId || '').trim() || null,
      eventType: isDeliveryFailure ? 'bounce' : 'reply',
      eventSource: 'reply_classify',
      eventAt: receivedAt,
      threadKey: String(threadKey || row.thread_key || '').trim() || null,
      threadId: String(threadId || row.thread_id || '').trim() || null,
      conversationId: String(conversationId || row.conversation_id || '').trim() || null,
      subject: String(subject || '').trim() || null,
      content: rawText,
      preview: preview || null,
      classification,
    });

    if (!ingestion.inserted) {
      return NextResponse.json({ success: true, duplicate: true, classification: failure || replyClassification });
    }

    if (shouldGloballySuppressReply(replyClassification) && row.email) {
      await recordInboundUnsubscribe(getSupabaseAdminClient(), {
        contactedId: row.id,
        recipientEmail: row.email,
        eventKey: ingestion.eventKey,
      });
    }

    if (!row.reply_intent && row.organization_id && (intent === 'meeting_request' || intent === 'positive')) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.antonia.ai';
      const summary = replyClassification?.summary || preview || 'Respuesta positiva detectada';
      await notificationService.sendAlert(
        row.organization_id,
        'Respuesta positiva detectada',
        `Lead ${row.email} respondió: ${summary}. Revisar: ${appUrl}/contacted/replied`
      );
    }

    if (row.organization_id && intent !== 'negative' && intent !== 'unsubscribe' && intent !== 'delivery_failure') {
      await maybeEscalateReplyReviewFromContactedId({
        supabase: getSupabaseAdminClient(),
        organizationId: row.organization_id,
        userId: row.user_id || user.id,
        contactedId,
        rawReply: rawText,
        replySubject: String(subject || ''),
      }).catch((error) => {
        console.warn('[replies/classify] escalation failed:', error);
      });
    }

    return NextResponse.json({ success: true, classification: failure || replyClassification });
  } catch (e: any) {
    console.error('[replies/classify] error:', e);
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
