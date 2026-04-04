import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { classifyReply, extractReplyPreview, type ReplyClassification } from '@/lib/reply-classifier';
import { detectDeliveryFailure } from '@/lib/delivery-failure-detector';
import { notificationService } from '@/lib/services/notification-service';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { maybeEscalateReplyReviewFromContactedId } from '@/lib/server/antonia-reply-escalation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function stripReplyTraceFields(updateData: any) {
  const copy = { ...updateData };
  delete copy.reply_snippet;
  return copy;
}

function hasReplyTraceColumnError(error: any) {
  const text = String(error?.message || error?.details || '').toLowerCase();
  return text.includes('reply_snippet');
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { contactedId, text, subject, from, html } = await req.json();
    if (!contactedId || (!text && !html)) {
      return NextResponse.json({ error: 'Missing contactedId or reply content' }, { status: 400 });
    }

    const { data: row } = await supabase
      .from('contacted_leads')
      .select('id, user_id, email, organization_id, reply_intent')
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

    const nowIso = new Date().toISOString();
    const isDeliveryFailure = Boolean(deliveryFailure);
    const failure = deliveryFailure;
    let replyClassification: ReplyClassification | null = null;
    if (!isDeliveryFailure) {
      replyClassification = await classifyReply(rawText);
    }
    const intent = isDeliveryFailure ? failure!.replyIntent : replyClassification!.intent;

    const evalStatus =
      intent === 'negative' || intent === 'unsubscribe'
        ? 'do_not_contact'
        : intent === 'delivery_failure'
          ? failure!.evaluationStatus
        : (intent === 'meeting_request' || intent === 'positive')
          ? 'action_required'
          : 'pending';

    const updateData: any = {
      status: isDeliveryFailure ? 'failed' : undefined,
      replied_at: isDeliveryFailure ? null : undefined,
      reply_preview: preview || null,
      reply_snippet: preview || null,
      last_reply_text: String(text || '').slice(0, 4000) || null,
      reply_intent: intent,
      reply_sentiment: isDeliveryFailure ? 'neutral' : replyClassification!.sentiment,
      reply_confidence: isDeliveryFailure ? 0.98 : replyClassification!.confidence,
      reply_summary: isDeliveryFailure
        ? failure!.bounceReason
        : replyClassification!.summary || null,
      campaign_followup_allowed: isDeliveryFailure ? failure!.campaignFollowupAllowed : replyClassification!.shouldContinue,
      campaign_followup_reason: isDeliveryFailure
        ? failure!.campaignFollowupReason
        : replyClassification!.reason || null,
      evaluation_status: evalStatus,
      delivery_status: isDeliveryFailure ? failure!.deliveryStatus : 'replied',
      bounced_at: isDeliveryFailure ? nowIso : null,
      bounce_category: isDeliveryFailure ? failure!.bounceCategory : null,
      bounce_reason: isDeliveryFailure ? failure!.bounceReason : null,
      last_interaction_at: nowIso,
      last_update_at: nowIso,
    };

    if (!isDeliveryFailure) {
      updateData.status = 'replied';
      updateData.replied_at = nowIso;
    }

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
      return NextResponse.json({ error: updateError.message || 'Failed to update classification' }, { status: 500 });
    }

    if ((intent === 'unsubscribe' || intent === 'negative') && row.email) {
      await supabase
        .from('unsubscribed_emails')
        .upsert({
          email: row.email,
          user_id: row.user_id || user.id,
          organization_id: row.organization_id || null,
          reason: `reply:${intent}`,
        }, { onConflict: 'email,user_id,organization_id' } as any);
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
