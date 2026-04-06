import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getDailyQuotaStatus, getUserScopedAntoniaQuotaStatus } from '@/lib/server/daily-quota-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const supabase = createRouteHandlerClient({ cookies });

        // Get authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            console.error('[QuotaAPI] Auth Error:', authError);
            return NextResponse.json({ error: 'Unauthorized', details: authError }, { status: 401 });
        }

        // Get user's organization (avoid maybeSingle to tolerate multi-org memberships)
        const { data: memberships, error: memberError } = await supabase
            .from('organization_members')
            .select('organization_id')
            .eq('user_id', user.id)
            .limit(1);

        if (memberError) {
            console.error('[QuotaAPI] Membership Error:', memberError);
            return NextResponse.json({ error: 'Membership query failed', details: memberError }, { status: 500 });
        }

        const membership = memberships?.[0] || null;

        if (!membership) {
            return NextResponse.json({ error: 'No organization found' }, { status: 404 });
        }

        const organizationId = membership.organization_id;
        const today = new Date().toISOString().split('T')[0];

        // Get today's usage (Use maybeSingle to avoid 406/PGRST116)
        const { data: usage, error: usageError } = await supabase
            .from('antonia_daily_usage')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('date', today)
            .maybeSingle();

        if (usageError) {
            console.error('[QuotaAPI] Usage Query Error:', usageError);
            // Don't fail completely, assume 0 usage
        }

        // Get active mission limits
        const { data: mission, error: missionError } = await supabase
            .from('antonia_missions')
            .select('daily_search_limit, daily_enrich_limit, daily_contact_limit, daily_investigate_limit')
            .eq('organization_id', organizationId)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (missionError) {
            console.error('[QuotaAPI] Mission Query Error:', missionError);
        }

        const activeMission = mission as any;

        // Default limits if no mission
        const searchRunLimit = activeMission?.daily_search_limit || 3;
        const enrichLimit = activeMission?.daily_enrich_limit || 10;
        const contactLimit = activeMission?.daily_contact_limit || 3;

        const enrichQuota = await getUserScopedAntoniaQuotaStatus({
            userId: user.id,
            organizationId,
            resource: 'enrich',
            limit: enrichLimit,
            organizationCount: usage?.leads_enriched || 0,
        });

        const investigateQuota = await getUserScopedAntoniaQuotaStatus({
            userId: user.id,
            organizationId,
            resource: 'investigate',
            limit: activeMission?.daily_investigate_limit || 5,
            organizationCount: usage?.leads_investigated || 0,
        });

        const contactQuota = await getDailyQuotaStatus({
            userId: user.id,
            organizationId,
            resource: 'contact',
            limit: activeMission?.daily_contact_limit || 3,
        });

        const quotaData = {
            searches: {
                used: usage?.leads_searched || 0,
                limit: searchRunLimit,
                runs: usage?.search_runs || 0
            },
            enrichments: {
                used: enrichQuota.count,
                limit: enrichQuota.limit
            },
            investigations: {
                used: investigateQuota.count,
                limit: investigateQuota.limit
            },
            contacts: {
                used: contactQuota.count,
                limit: contactQuota.limit
            },
            date: today
        };

        return NextResponse.json(quotaData);

    } catch (e: any) {
        console.error('[QuotaAPI] Unexpected Error:', e);
        return NextResponse.json({ error: 'Internal Server Error', message: e.message }, { status: 500 });
    }
}
