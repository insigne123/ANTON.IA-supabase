import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RescueBody = {
    olderThanMinutes?: number;
    limit?: number;
};

function clamp(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.floor(value), min), max);
}

export async function POST(req: NextRequest) {
    try {
        const claims = authenticateOpenClawRequest(req, ['tasks:admin']);
        const supabase = getSupabaseAdminClient();

        let body: RescueBody = {};
        try {
            body = (await req.json()) as RescueBody;
        } catch {
            body = {};
        }

        const olderThanMinutes = clamp(Number(body.olderThanMinutes), 1, 240, 15);
        const limit = clamp(Number(body.limit), 1, 500, 100);
        const cutoffIso = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
        const nowIso = new Date().toISOString();

        const { data: stuck, error: stuckError } = await supabase
            .from('antonia_tasks')
            .select('id, mission_id, type, updated_at, processing_started_at, heartbeat_at')
            .eq('organization_id', claims.orgId)
            .eq('status', 'processing')
            .lt('updated_at', cutoffIso)
            .order('updated_at', { ascending: true })
            .limit(limit);

        if (stuckError) {
            throw new Error(stuckError.message || 'Failed to query stuck tasks');
        }

        const stuckList = stuck || [];
        if (stuckList.length === 0) {
            return NextResponse.json({
                ok: true,
                data: {
                    rescuedCount: 0,
                    cutoffIso,
                    tasks: [],
                },
            });
        }

        const ids = stuckList.map((task) => task.id);

        const { error: updateError } = await supabase
            .from('antonia_tasks')
            .update({
                status: 'pending',
                scheduled_for: nowIso,
                processing_started_at: null,
                error_message: 'Rescued by OpenClaw (stuck processing task)',
                updated_at: nowIso,
            })
            .in('id', ids);

        if (updateError) {
            throw new Error(updateError.message || 'Failed to rescue stuck tasks');
        }

        await supabase.from('antonia_logs').insert({
            mission_id: null,
            organization_id: claims.orgId,
            level: 'warning',
            message: `OpenClaw rescued ${ids.length} stuck task(s)`,
            details: {
                taskIds: ids,
                olderThanMinutes,
                source: 'openclaw',
            },
            created_at: nowIso,
        });

        return NextResponse.json({
            ok: true,
            data: {
                rescuedCount: ids.length,
                cutoffIso,
                tasks: stuckList,
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
                    code: 'OPENCLAW_TASK_RESCUE_ERROR',
                    message: String(error?.message || 'Failed to rescue stuck tasks'),
                },
            },
            { status: 500 }
        );
    }
}
