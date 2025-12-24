import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const supabase = createRouteHandlerClient({ cookies });

    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's organization
    const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .single();

    if (!membership) {
        return NextResponse.json({ error: 'No organization found' }, { status: 404 });
    }

    const organizationId = membership.organization_id;
    const today = new Date().toISOString().split('T')[0];

    // Get today's usage
    const { data: usage } = await supabase
        .from('antonia_daily_usage')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('date', today)
        .single();

    // Get active mission limits
    const { data: mission } = await supabase
        .from('antonia_missions')
        .select('daily_enrich_limit, daily_contact_limit')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    // Default limits if no mission
    const enrichLimit = mission?.daily_enrich_limit || 10;
    const contactLimit = mission?.daily_contact_limit || 3;

    // Count contacts today (from contacted_leads table)
    const { count: contactsToday } = await supabase
        .from('contacted_leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .gte('contacted_at', `${today}T00:00:00Z`);

    const quotaData = {
        searches: {
            used: usage?.leads_searched || 0,
            limit: 1000, // No hard limit, just tracking
            runs: usage?.search_runs || 0
        },
        enrichments: {
            used: usage?.leads_enriched || 0,
            limit: enrichLimit
        },
        investigations: {
            used: usage?.leads_investigated || 0,
            limit: enrichLimit // Usually same as enrich
        },
        contacts: {
            used: contactsToday || 0,
            limit: contactLimit
        },
        date: today
    };

    return NextResponse.json(quotaData);
}
