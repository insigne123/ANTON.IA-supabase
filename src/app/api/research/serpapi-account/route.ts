import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

import { getAvailableSerpApiCredits, getSerpApiAccountStatus } from '@/lib/server/serpapi-account';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user?.id) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const { data: memberships, error: memberError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1);

    if (memberError) {
      return NextResponse.json({ error: 'MEMBERSHIP_QUERY_FAILED' }, { status: 500 });
    }

    const organizationId = memberships?.[0]?.organization_id || null;
    let enabled = true;
    let fallbackCredits = 0;

    if (organizationId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('social_search_credits, feature_social_search_enabled')
        .eq('id', organizationId)
        .limit(1)
        .maybeSingle();

      enabled = org?.feature_social_search_enabled ?? true;
      fallbackCredits = Number(org?.social_search_credits ?? 0);
    }

    try {
      const serpApi = await getSerpApiAccountStatus();
      if (serpApi.configured) {
        return NextResponse.json({
          credits: Math.max(0, getAvailableSerpApiCredits(serpApi)),
          enabled,
          source: 'serpapi',
          serpapi: {
            totalSearchesLeft: serpApi.totalSearchesLeft,
            planSearchesLeft: serpApi.planSearchesLeft,
            extraCredits: serpApi.extraCredits,
            thisMonthUsage: serpApi.thisMonthUsage,
            accountRateLimitPerHour: serpApi.accountRateLimitPerHour,
            planName: serpApi.planName,
          },
        });
      }
    } catch (error: any) {
      return NextResponse.json({
        credits: Math.max(0, fallbackCredits),
        enabled,
        source: 'organization',
        warning: error?.message || 'SERPAPI_ACCOUNT_LOOKUP_FAILED',
      });
    }

    return NextResponse.json({
      credits: Math.max(0, fallbackCredits),
      enabled,
      source: 'organization',
      warning: 'SERPAPI_API_KEY_NOT_CONFIGURED',
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'SERPAPI_ACCOUNT_ROUTE_ERROR', message: error?.message || 'Unknown error' }, { status: 500 });
  }
}
