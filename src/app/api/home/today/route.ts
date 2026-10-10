import { NextResponse } from 'next/server';
import { handleAuthError } from '@/lib/server/auth-utils';
import {requireHomeAuth} from '@/lib/server/home-auth';
import {requestAuthErrorResponse} from '@/lib/server/request-auth';
import {homeScope} from '@/lib/home/scope';
import {preferredFullName} from '@/lib/lead-name';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import { buildTodayPlan, commitmentDueToday, replyNeedsAnswer } from '@/lib/home/today';

export const dynamic = 'force-dynamic';

const READY_SCAN_LIMIT = 1000;

/** «Hoy» for the signed-in person: their own setup, replies, commitments and contacts ready to write (src/lib/home/today.ts). */
export async function GET(request:Request) {
  try {
    const { supabase, organizationId, user } = await requireHomeAuth(request);
    const own = <T extends { eq: (column: string, value: string) => T }>(query: T) =>
      query.eq('organization_id', organizationId).eq('user_id', user.id);

    const [profileRes, tokensRes, savedRes, enrichedRes, sentRes, repliedRes, commitmentsRes] = await Promise.all([
      supabase.from('profiles').select('company_name,company_domain,full_name,job_title,signatures').eq('id', user.id).maybeSingle(),
      // Tokens are service-only; only which providers are connected leaves this route (as /api/integrations/store-token does).
      getSupabaseAdminClient().from('provider_tokens').select('provider').eq('user_id', user.id),
      own(supabase.from('leads').select('id', { count: 'exact', head: true })),
      own(supabase.from('enriched_leads').select('email')).not('email', 'is', null).neq('email', '').limit(READY_SCAN_LIMIT),
      own(supabase.from('contacted_leads').select('email')).not('sent_at','is',null).limit(5000),
      own(supabase.from('contacted_leads').select('id,email,name,company,reply_intent,replied_at,conversation_resolved_at,conversation_outbound_at'))
        .not('replied_at', 'is', null).order('replied_at', { ascending: false }).limit(200),
      own(supabase.from('contacted_leads').select('id,name,company,data')).not('data->commitment', 'is', null).limit(200),
    ]);

    for(const result of [profileRes,tokensRes,savedRes,enrichedRes,sentRes,repliedRes,commitmentsRes])if(result.error)throw Error('No pudimos comprobar tus pendientes.');
    const firstSend=await own(supabase.from('outbound_dispatches').select('id',{count:'exact',head:true})).eq('status','sent').eq('channel','email');
    if(firstSend.error)throw Error('No pudimos comprobar tu primer envío.');

    const form = mapProfileToForm(profileRes.data as any);
    const hasOffer = [form.valueProposition, form.description, form.services].some((value) => String(value || '').trim().length > 0);
    const contactedEmails = new Set((sentRes.data || []).map((row: any) => String(row.email || '').trim().toLowerCase()).filter(Boolean));
    const enrichedEmails = [...new Set((enrichedRes.data || []).map((row: any) => String(row.email || '').trim().toLowerCase()).filter(Boolean))];
    const now = new Date();
    const pendingReplies=new Map<string,any>();
    for(const row of (repliedRes.data||[]).filter(replyNeedsAnswer)){
      const key=String(row.email||row.id).trim().toLowerCase(),prior=pendingReplies.get(key);
      if(prior)prior.name=preferredFullName(prior.name,row.name);else pendingReplies.set(key,{...row});
    }

    const plan = buildTodayPlan({
      now,
      profile: { companyName: String(form.companyName || profileRes.data?.company_name || ''), hasOffer },
      mailProviders: [...new Set((tokensRes.data || []).map((row: any) => String(row.provider || '')).filter(Boolean))],
      counts: {
        saved: savedRes.count || 0,
        withEmail: enrichedEmails.length,
        readyToWrite: enrichedEmails.filter((email) => !contactedEmails.has(email)).length,
        sent: firstSend.count||0,
      },
      replies: [...pendingReplies.values()].slice(0, 10).map((row: any) => ({
        id: String(row.id), name: String(row.name || ''), company: String(row.company || ''),
        intent: row.reply_intent || null, repliedAt: String(row.replied_at),
      })),
      commitments: (commitmentsRes.data || []).flatMap((row: any) => {
        const due = commitmentDueToday(row.data?.commitment, now);
        return due ? [{ id: String(row.id), name: String(row.name || ''), company: String(row.company || ''), ...due }] : [];
      }),
    });

    return NextResponse.json({
      scope:homeScope(user.id,organizationId,now),
      ...plan,
      partial: (enrichedRes.data || []).length >= READY_SCAN_LIMIT || (sentRes.data||[]).length>=5000 || (repliedRes.data||[]).length>=200 || (commitmentsRes.data||[]).length>=200,
      firstName: String(form.name || '').trim().split(/\s+/)[0] || '',
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return requestAuthErrorResponse(error)||handleAuthError(error);
  }
}
