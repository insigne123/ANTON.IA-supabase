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
        const [creditQuota, contactQuota] = await Promise.all([
            getDailyQuotaStatus({ userId: user.id, organizationId, resource: 'search', limit: limits.leadSearch }),
            getDailyQuotaStatus({ userId: user.id, organizationId, resource: 'contact', limit: limits.contact }),
        ]);

        const quotaData = {
            credits: {
                used: creditQuota.count,
                limit: creditQuota.limit,
                remaining: Math.max(0, creditQuota.limit - creditQuota.count),
            },
            contacts: {
                used: contactQuota.count,
                limit: contactQuota.limit
            },
            date: creditQuota.dayKey
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
