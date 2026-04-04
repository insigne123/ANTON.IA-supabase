import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ taskId: string }> }
) {
    try {
        const claims = authenticateOpenClawRequest(req, ['tasks:admin']);
        const supabase = getSupabaseAdminClient();
        const { taskId } = await context.params;

        const { data: task, error: taskError } = await supabase
            .from('antonia_tasks')
            .select('id, mission_id, organization_id, type, status, retry_count')
            .eq('id', taskId)
            .eq('organization_id', claims.orgId)
            .maybeSingle();

        if (taskError) {
            throw new Error(taskError.message || 'Failed to query task');
        }

        if (!task) {
            return NextResponse.json(
                { ok: false, error: { code: 'OPENCLAW_TASK_NOT_FOUND', message: 'Task not found' } },
                { status: 404 }
            );
        }

        const retryCount = Number(task.retry_count || 0) + 1;
        const nowIso = new Date().toISOString();

        const { data: updated, error: updateError } = await supabase
            .from('antonia_tasks')
            .update({
                status: 'pending',
                retry_count: retryCount,
                scheduled_for: nowIso,
                processing_started_at: null,
                error_message: null,
                updated_at: nowIso,
            })
            .eq('id', task.id)
            .select('id, mission_id, type, status, retry_count, scheduled_for, updated_at')
            .single();

        if (updateError) {
            throw new Error(updateError.message || 'Failed to retry task');
        }

        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: claims.orgId,
            level: 'warning',
            message: `Task retried by OpenClaw: ${task.type}`,
            details: {
                taskId: task.id,
                retryCount,
                source: 'openclaw',
            },
            created_at: nowIso,
        });

        return NextResponse.json({
            ok: true,
            data: {
                task: updated,
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
                    code: 'OPENCLAW_TASK_RETRY_ERROR',
                    message: String(error?.message || 'Failed to retry task'),
                },
            },
            { status: 500 }
        );
    }
}
