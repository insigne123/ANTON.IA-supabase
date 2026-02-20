import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { authenticateOpenClawRequest, OpenClawAuthError } from '@/lib/server/openclaw-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ missionId: string }> }
) {
    try {
        const claims = authenticateOpenClawRequest(req, ['missions:write']);
        const supabase = getSupabaseAdminClient();

        const { missionId } = await context.params;
        if (!missionId) {
            return NextResponse.json(
                { ok: false, error: { code: 'OPENCLAW_MISSION_ID_REQUIRED', message: 'missionId is required' } },
                { status: 400 }
            );
        }

        const { data: mission, error: missionError } = await supabase
            .from('antonia_missions')
            .select('id, title, user_id, organization_id, params')
            .eq('id', missionId)
            .eq('organization_id', claims.orgId)
            .maybeSingle();

        if (missionError) {
            throw new Error(missionError.message || 'Failed to query mission');
        }

        if (!mission) {
            return NextResponse.json(
                { ok: false, error: { code: 'OPENCLAW_MISSION_NOT_FOUND', message: 'Mission not found' } },
                { status: 404 }
            );
        }

        const missionParams = mission.params || {};
        const initialTaskType = missionParams.autoGenerateCampaign ? 'GENERATE_CAMPAIGN' : 'SEARCH';
        const requestedKey = String(req.headers.get('idempotency-key') || '').trim();
        const idempotencyKey =
            requestedKey || `mission_${missionId}_openclaw_trigger_${Date.now().toString(36)}`;

        const payload = {
            userId: mission.user_id,
            jobTitle: missionParams.jobTitle,
            location: missionParams.location,
            industry: missionParams.industry,
            keywords: missionParams.keywords || '',
            companySize: missionParams.companySize || '',
            seniorities: missionParams.seniorities || [],
            enrichmentLevel: missionParams.enrichmentLevel,
            campaignName: missionParams.campaignName,
            campaignContext: missionParams.campaignContext || '',
            missionTitle: mission.title,
        };

        let task: any = null;
        const { data: inserted, error: insertError } = await supabase
            .from('antonia_tasks')
            .insert({
                mission_id: mission.id,
                organization_id: claims.orgId,
                type: initialTaskType,
                status: 'pending',
                payload,
                idempotency_key: idempotencyKey,
                created_at: new Date().toISOString(),
            })
            .select('id, mission_id, type, status, idempotency_key, created_at')
            .single();

        if (insertError) {
            const code = String((insertError as any)?.code || '');
            if (code === '23505') {
                const { data: existing, error: existingError } = await supabase
                    .from('antonia_tasks')
                    .select('id, mission_id, type, status, idempotency_key, created_at')
                    .eq('organization_id', claims.orgId)
                    .eq('idempotency_key', idempotencyKey)
                    .maybeSingle();

                if (existingError) {
                    throw new Error(existingError.message || 'Failed to resolve idempotent task');
                }

                task = existing;
            } else {
                throw new Error(insertError.message || 'Failed to create task');
            }
        } else {
            task = inserted;
        }

        await supabase.from('antonia_logs').insert({
            mission_id: mission.id,
            organization_id: claims.orgId,
            level: 'info',
            message: `Mission triggered by OpenClaw: ${mission.title}`,
            details: {
                taskId: task?.id || null,
                taskType: initialTaskType,
                idempotencyKey,
                source: 'openclaw',
            },
            created_at: new Date().toISOString(),
        });

        return NextResponse.json({
            ok: true,
            data: {
                missionId: mission.id,
                task,
                idempotencyKey,
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
                    code: 'OPENCLAW_TRIGGER_MISSION_ERROR',
                    message: String(error?.message || 'Failed to trigger mission'),
                },
            },
            { status: 500 }
        );
    }
}
