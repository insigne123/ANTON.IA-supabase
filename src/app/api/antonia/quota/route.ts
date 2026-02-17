import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

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

        // Count contacts today (from contacted_leads table)
        const { count: contactsToday, error: contactsError } = await supabase
            .from('contacted_leads')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .gte('created_at', `${today}T00:00:00Z`);

        if (contactsError) {
            console.error('[QuotaAPI] Contacts Count Error:', contactsError);
        }

        const quotaData = {
            searches: {
                used: usage?.leads_searched || 0,
                limit: searchRunLimit,
                runs: usage?.search_runs || 0
            },
            enrichments: {
                used: usage?.leads_enriched || 0,
                limit: enrichLimit
            },
            investigations: {
                used: usage?.leads_investigated || 0,
                limit: activeMission?.daily_investigate_limit || 5 // Default fallbacks
            },
            contacts: {
                used: contactsToday || 0,
                limit: contactLimit
            },
            date: today
        };

        return NextResponse.json(quotaData);

    } catch (e: any) {
        console.error('[QuotaAPI] Unexpected Error:', e);
        return NextResponse.json({ error: 'Internal Server Error', message: e.message }, { status: 500 });
    }
}
