import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clampLimit(raw: string | null, fallback = 50, max = 200): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    const rounded = Math.floor(value);
    return Math.min(Math.max(rounded, 1), max);
}

export async function GET(req: NextRequest) {
    try {
        const claims = authenticateOpenClawRequest(req, ['tasks:read']);
        const supabase = getSupabaseAdminClient();

        const status = String(req.nextUrl.searchParams.get('status') || '').trim();
        const type = String(req.nextUrl.searchParams.get('type') || '').trim();
        const missionId = String(req.nextUrl.searchParams.get('missionId') || '').trim();
        const limit = clampLimit(req.nextUrl.searchParams.get('limit'));
        const includePayload =
            String(req.nextUrl.searchParams.get('includePayload') || '').toLowerCase() === 'true';

        const selectColumns = includePayload
            ? 'id, mission_id, organization_id, type, status, payload, result, error_message, retry_count, scheduled_for, processing_started_at, heartbeat_at, progress_current, progress_total, progress_label, worker_id, worker_source, created_at, updated_at'
            : 'id, mission_id, organization_id, type, status, error_message, retry_count, scheduled_for, processing_started_at, heartbeat_at, progress_current, progress_total, progress_label, worker_id, worker_source, created_at, updated_at';

        const tasksTable: any = (supabase as any).from('antonia_tasks');
        let listQuery: any = tasksTable
            .select(selectColumns, { count: 'exact' })
            .eq('organization_id', claims.orgId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status) {
            listQuery = listQuery.eq('status', status);
        }

        if (type) {
            listQuery = listQuery.eq('type', type);
        }

        if (missionId) {
            listQuery = listQuery.eq('mission_id', missionId);
        }

        const [listRes, pendingRes, processingRes, failedRes, completedRes] = await Promise.all([
            listQuery,
            supabase
                .from('antonia_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', claims.orgId)
                .eq('status', 'pending'),
            supabase
                .from('antonia_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', claims.orgId)
                .eq('status', 'processing'),
            supabase
                .from('antonia_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', claims.orgId)
                .eq('status', 'failed'),
            supabase
                .from('antonia_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', claims.orgId)
                .eq('status', 'completed'),
        ]);

        const queryErrors = [
            listRes.error,
            pendingRes.error,
            processingRes.error,
            failedRes.error,
            completedRes.error,
        ].filter(Boolean);

        if (queryErrors.length > 0) {
            const first = queryErrors[0] as any;
            throw new Error(first?.message || 'Failed to list tasks');
        }

        return NextResponse.json({
            ok: true,
            data: {
                organizationId: claims.orgId,
                total: listRes.count || 0,
                limit,
                statusCounts: {
                    pending: pendingRes.count || 0,
                    processing: processingRes.count || 0,
                    failed: failedRes.count || 0,
                    completed: completedRes.count || 0,
                },
                items: listRes.data || [],
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
                    code: 'OPENCLAW_TASKS_LIST_ERROR',
                    message: String(error?.message || 'Failed to list tasks'),
                },
            },
            { status: 500 }
        );
    }
}
