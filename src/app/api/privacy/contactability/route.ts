import { NextRequest, NextResponse } from 'next/server';

import { cleanDomain, getContactabilityCopy, normalizeEmail, type ContactabilityStatus } from '@/lib/commercial-intelligence';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function responseFor(status: ContactabilityStatus, reasons: string[]) {
  const copy = getContactabilityCopy(status);
  return NextResponse.json({ status, reasons, ...copy });
}

export async function GET(req: NextRequest) {
  try {
    const { user, organizationId } = await requireAuth();
    const email = normalizeEmail(req.nextUrl.searchParams.get('email'));

    if (!email || !email.includes('@')) {
      return responseFor('missing_email', ['missing_email']);
    }

    const reasons: string[] = [];
    const admin = getSupabaseAdminClient();
    const domain = cleanDomain(email.split('@')[1] || '');

    const suppressed = await isEmailSuppressedForScope(email, { userId: user.id, organizationId });
    if (suppressed) reasons.push('unsubscribe_or_privacy_block');

    if (domain) {
      const { data: blockedDomain, error: domainError } = await admin
        .from('excluded_domains')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('domain', domain)
        .maybeSingle();

      if (domainError) {
        console.warn('[contactability] domain check failed:', domainError.message);
      }
      if (blockedDomain?.id) reasons.push('blocked_domain');
    }

    const { data: latestContact } = await admin
      .from('contacted_leads')
      .select('id, delivery_status, evaluation_status, campaign_followup_allowed, campaign_followup_reason, bounced_at, replied_at, reply_intent')
      .eq('organization_id', organizationId)
      .eq('email', email)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestContact?.evaluation_status === 'do_not_contact' || latestContact?.campaign_followup_allowed === false) {
      reasons.push('do_not_contact');
    }
    if (latestContact?.bounced_at || String(latestContact?.delivery_status || '').includes('bounce')) {
      reasons.push('recent_bounce');
    }
    if (latestContact?.reply_intent === 'unsubscribe') {
      reasons.push('unsubscribe_reply');
    }

    if (reasons.some((reason) => ['unsubscribe_or_privacy_block', 'blocked_domain', 'do_not_contact', 'unsubscribe_reply'].includes(reason))) {
      return responseFor('blocked', reasons);
    }

    if (reasons.length > 0) {
      return responseFor('warning', reasons);
    }

    return responseFor('ok', []);
  } catch (error) {
    return handleAuthError(error);
  }
}
