import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { buildCampaignPersonalization } from '@/lib/server/campaign-reconnection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { campaignId, leadId, leadEmail, stepIndex, matchReason, daysSinceLastContact } = await req.json();

    if (!campaignId || leadId == null || stepIndex == null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('id, name, organization_id, settings')
      .eq('id', campaignId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const { data: steps } = await supabase
      .from('campaign_steps')
      .select('id, name, order_index, offset_days, subject_template, body_template')
      .eq('campaign_id', campaignId)
      .order('order_index', { ascending: true });

    const step = (steps || [])[Number(stepIndex)];
    if (!step) {
      return NextResponse.json({ error: 'Campaign step not found' }, { status: 404 });
    }

    let leadQuery = supabase
      .from('contacted_leads')
      .select('*')
      .eq('user_id', user.id)
      .eq('lead_id', String(leadId))
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let { data: contactedLead } = await leadQuery;

    if (!contactedLead && leadEmail) {
      const retry = await supabase
        .from('contacted_leads')
        .select('*')
        .eq('user_id', user.id)
        .ilike('email', String(leadEmail))
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      contactedLead = retry.data;
    }

    if (!contactedLead) {
      return NextResponse.json({ error: 'Contacted lead not found' }, { status: 404 });
    }

    const personalization = await buildCampaignPersonalization({
      campaign,
      step: {
        name: step.name,
        offsetDays: step.offset_days,
        subject: step.subject_template,
        bodyHtml: step.body_template,
      },
      stepIndex: Number(stepIndex),
      totalSteps: (steps || []).length,
      contactedLead: {
        id: contactedLead.id,
        organizationId: contactedLead.organization_id,
        leadId: contactedLead.lead_id,
        name: contactedLead.name,
        email: contactedLead.email,
        company: contactedLead.company,
        role: contactedLead.role,
        industry: contactedLead.industry,
        city: contactedLead.city,
        country: contactedLead.country,
        subject: contactedLead.subject,
        sentAt: contactedLead.sent_at,
        status: contactedLead.status,
        provider: contactedLead.provider,
        messageId: contactedLead.message_id,
        conversationId: contactedLead.conversation_id,
        threadId: contactedLead.thread_id,
        internetMessageId: contactedLead.internet_message_id,
        openedAt: contactedLead.opened_at,
        clickedAt: contactedLead.clicked_at,
        clickCount: contactedLead.click_count,
        deliveredAt: contactedLead.delivered_at,
        deliveryStatus: contactedLead.delivery_status,
        bouncedAt: contactedLead.bounced_at,
        bounceCategory: contactedLead.bounce_category,
        bounceReason: contactedLead.bounce_reason,
        repliedAt: contactedLead.replied_at,
        lastFollowUpAt: contactedLead.last_follow_up_at,
        lastInteractionAt: contactedLead.last_interaction_at,
        evaluationStatus: contactedLead.evaluation_status,
        replyIntent: contactedLead.reply_intent,
        campaignFollowupAllowed: contactedLead.campaign_followup_allowed,
      } as any,
      userId: user.id,
      organizationId: campaign.organization_id,
      matchReason: typeof matchReason === 'string' ? matchReason : null,
      daysSinceLastContact: typeof daysSinceLastContact === 'number' ? daysSinceLastContact : undefined,
    });

    return NextResponse.json(personalization);
  } catch (error: any) {
    console.error('[campaigns/personalize] error:', error);
    return NextResponse.json({ error: error?.message || 'Unexpected error' }, { status: 500 });
  }
}
