import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { classifyReply, extractReplyPreview } from '@/lib/reply-classifier';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { contactedId, text } = await req.json();
    if (!contactedId || !text) {
      return NextResponse.json({ error: 'Missing contactedId or text' }, { status: 400 });
    }

    const { data: row } = await supabase
      .from('contacted_leads')
      .select('id, user_id, email, organization_id')
      .eq('id', contactedId)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({ error: 'Contacted lead not found' }, { status: 404 });
    }

    const classification = await classifyReply(String(text || ''));
    const preview = extractReplyPreview(String(text || ''));

    const updateData: any = {
      reply_preview: preview || null,
      last_reply_text: String(text || '').slice(0, 4000) || null,
      reply_intent: classification.intent,
      reply_sentiment: classification.sentiment,
      reply_confidence: classification.confidence,
      reply_summary: classification.summary || null,
      campaign_followup_allowed: classification.shouldContinue,
      campaign_followup_reason: classification.reason || null,
      last_update_at: new Date().toISOString(),
    };

    await supabase
      .from('contacted_leads')
      .update(updateData)
      .eq('id', contactedId);

    if ((classification.intent === 'unsubscribe' || classification.intent === 'negative') && row.email) {
      await supabase
        .from('unsubscribed_emails')
        .upsert({
          email: row.email,
          user_id: row.user_id || user.id,
          organization_id: row.organization_id || null,
          reason: `reply:${classification.intent}`,
        }, { onConflict: 'email,user_id,organization_id' } as any);
    }

    return NextResponse.json({ success: true, classification });
  } catch (e: any) {
    console.error('[replies/classify] error:', e);
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
