import { NextResponse } from 'next/server';
import { getDailyQuotaStatus, getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { user, organizationId } = await requireAuth();
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
        if (e?.name === 'AuthError') return handleAuthError(e);
        console.error('[QuotaAPI] Unexpected Error:', e);
        return NextResponse.json({ error: 'Internal Server Error', message: e.message }, { status: 500 });
    }
}
