import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getDailyQuotaStatus, getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';

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
            .order('created_at', { ascending: true })
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
        const limits = await getEffectiveDailyQuotaLimits({ userId: user.id, organizationId });
        const [searchQuota, enrichQuota, investigateQuota, contactQuota] = await Promise.all([
            getDailyQuotaStatus({ userId: user.id, organizationId, resource: 'search', limit: limits.leadSearch }),
            getDailyQuotaStatus({ userId: user.id, organizationId, resource: 'enrich', limit: limits.enrich }),
            getDailyQuotaStatus({ userId: user.id, organizationId, resource: 'research', limit: limits.research }),
            getDailyQuotaStatus({ userId: user.id, organizationId, resource: 'contact', limit: limits.contact }),
        ]);

        const quotaData = {
            searches: {
                used: searchQuota.count,
                limit: searchQuota.limit,
                runs: searchQuota.count,
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
            date: searchQuota.dayKey
        };

        return NextResponse.json(quotaData, {
            headers: {
                'Cache-Control': 'private, no-store, max-age=0',
                Vary: 'Cookie',
            },
        });

    } catch (e: any) {
        console.error('[QuotaAPI] Unexpected Error:', e);
        return NextResponse.json({ error: 'Internal Server Error', message: e.message }, { status: 500 });
    }
}
