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

        const orgId = claims.orgId;
        const today = todayIsoDate();
        const todayStart = `${today}T00:00:00Z`;
        const stuckThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();

        const [
            activeMissionsRes,
            pendingTasksRes,
            processingTasksRes,
            failedTasksRes,
            stuckTasksRes,
            dailyUsageRes,
            contactsTodayRes,
            recentErrorsRes,
            recentLogsRes,
        ] = await Promise.all([
            supabase
                .from('antonia_missions')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .eq('status', 'active'),
            supabase
                .from('antonia_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .eq('status', 'pending'),
            supabase
                .from('antonia_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .eq('status', 'processing'),
            supabase
                .from('antonia_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .eq('status', 'failed'),
            supabase
                .from('antonia_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .eq('status', 'processing')
                .lt('updated_at', stuckThreshold),
            supabase
                .from('antonia_daily_usage')
                .select('date, leads_searched, leads_enriched, leads_investigated, search_runs, updated_at')
                .eq('organization_id', orgId)
                .eq('date', today)
                .maybeSingle(),
            supabase
                .from('contacted_leads')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .gte('created_at', todayStart),
            supabase
                .from('antonia_tasks')
                .select('id, mission_id, type, error_message, retry_count, updated_at')
                .eq('organization_id', orgId)
                .eq('status', 'failed')
                .order('updated_at', { ascending: false })
                .limit(10),
            supabase
                .from('antonia_logs')
                .select('id, mission_id, level, message, created_at')
                .eq('organization_id', orgId)
                .order('created_at', { ascending: false })
                .limit(20),
        ]);

        const queryErrors = [
            activeMissionsRes.error,
            pendingTasksRes.error,
            processingTasksRes.error,
            failedTasksRes.error,
            stuckTasksRes.error,
            dailyUsageRes.error,
            contactsTodayRes.error,
            recentErrorsRes.error,
            recentLogsRes.error,
        ].filter(Boolean);

        if (queryErrors.length > 0) {
            const first = queryErrors[0] as any;
            throw new Error(first?.message || 'Failed to build overview');
        }

        return NextResponse.json({
            ok: true,
            data: {
                organizationId: orgId,
                timestamp: new Date().toISOString(),
                missions: {
                    active: activeMissionsRes.count || 0,
                },
                tasks: {
                    pending: pendingTasksRes.count || 0,
                    processing: processingTasksRes.count || 0,
                    failed: failedTasksRes.count || 0,
                    stuck: stuckTasksRes.count || 0,
                    recentFailures: recentErrorsRes.data || [],
                },
                usageToday: dailyUsageRes.data || {
                    date: today,
                    leads_searched: 0,
                    leads_enriched: 0,
                    leads_investigated: 0,
                    search_runs: 0,
                    updated_at: null,
                },
                contactsToday: contactsTodayRes.count || 0,
                logs: recentLogsRes.data || [],
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
                    code: 'OPENCLAW_OVERVIEW_ERROR',
                    message: String(error?.message || 'Failed to fetch overview'),
                },
            },
            { status: 500 }
        );
    }
}
