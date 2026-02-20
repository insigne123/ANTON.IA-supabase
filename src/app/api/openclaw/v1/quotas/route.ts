import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
    try {
        const claims = authenticateOpenClawRequest(req, ['system:read']);
        const supabase = getSupabaseAdminClient();

        const today = todayIsoDate();

        const [usageRes, missionRes, contactsRes] = await Promise.all([
            supabase
                .from('antonia_daily_usage')
                .select('date, leads_searched, leads_enriched, leads_investigated, search_runs, updated_at')
                .eq('organization_id', claims.orgId)
                .eq('date', today)
                .maybeSingle(),
            supabase
                .from('antonia_missions')
                .select('id, status, daily_search_limit, daily_enrich_limit, daily_contact_limit, daily_investigate_limit, created_at')
                .eq('organization_id', claims.orgId)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            supabase
                .from('contacted_leads')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', claims.orgId)
                .gte('created_at', `${today}T00:00:00Z`),
        ]);

        if (usageRes.error) throw new Error(usageRes.error.message || 'Failed to query daily usage');
        if (missionRes.error) throw new Error(missionRes.error.message || 'Failed to query active mission');
        if (contactsRes.error) throw new Error(contactsRes.error.message || 'Failed to query contacts today');

        const usage = usageRes.data || {
            date: today,
            leads_searched: 0,
            leads_enriched: 0,
            leads_investigated: 0,
            search_runs: 0,
            updated_at: null,
        };
        const mission = missionRes.data;

        return NextResponse.json({
            ok: true,
            data: {
                organizationId: claims.orgId,
                date: today,
                limits: {
                    daily_search_limit: Number(mission?.daily_search_limit || 3),
                    daily_enrich_limit: Number(mission?.daily_enrich_limit || 10),
                    daily_contact_limit: Number(mission?.daily_contact_limit || 3),
                    daily_investigate_limit: Number(mission?.daily_investigate_limit || 5),
                },
                usage: {
                    search_runs: Number((usage as any).search_runs || 0),
                    leads_searched: Number((usage as any).leads_searched || 0),
                    leads_enriched: Number((usage as any).leads_enriched || 0),
                    leads_investigated: Number((usage as any).leads_investigated || 0),
                    contacts_sent_today: Number(contactsRes.count || 0),
                },
                activeMissionId: mission?.id || null,
                updatedAt: (usage as any).updated_at || null,
            },
        });
    } catch (error: any) {
        if (error instanceof OpenClawAuthError) {
            return NextResponse.json(
                { ok: false, error: { code: error.code, message: error.message } },
                { status: error.status }
            );
        }

        return NextResponse.json(
            {
                ok: false,
                error: {
                    code: 'OPENCLAW_QUOTAS_ERROR',
                    message: String(error?.message || 'Failed to fetch quotas'),
                },
            },
            { status: 500 }
        );
    }
}
