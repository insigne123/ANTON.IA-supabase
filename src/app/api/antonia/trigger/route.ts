import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';

export async function POST(req: NextRequest) {
    try {
        // Initialize Supabase client at runtime, not at module load time
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { missionId } = await req.json();
        const requestId = req.headers.get('x-request-id')?.trim() || `mission-trigger:${missionId || 'unknown'}`;

        if (!missionId) {
            return NextResponse.json({ error: 'missionId required' }, { status: 400 });
        }

        // 1. Auth Check - Triggering requires authentication
        const supabaseAuth = createRouteHandlerClient({ cookies });
        const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get mission details - Use authenticated client to ensure RLS applies
        const { data: mission, error: missionError } = await supabaseAuth
            .from('antonia_missions')
            .select('*')
            .eq('id', missionId)
            .single();

        if (missionError || !mission) {
            return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
        }

        if (mission.status !== 'active') {
            return NextResponse.json({ error: 'Mission is not active' }, { status: 409 });
        }

        // Check for Auto Campaign Strategy
        const isAutoCampaign = mission.params.autoGenerateCampaign;
        const initialTaskType = isAutoCampaign ? 'GENERATE_CAMPAIGN' : 'SEARCH';
        const initialTaskIdempotencyKey = `mission_${missionId}_init_v2`;

        const { data: existingTask, error: existingTaskError } = await supabase
            .from('antonia_tasks')
            .select('id, type, status')
            .eq('mission_id', missionId)
            .eq('idempotency_key', initialTaskIdempotencyKey)
            .maybeSingle();
        if (existingTaskError) throw existingTaskError;
        if (existingTask) {
            await safeAppendAntoniaEvent({
                eventType: 'mission.trigger_replayed',
                organizationId: mission.organization_id,
                actorId: user.id,
                actorType: 'user',
                entityType: 'mission',
                entityId: missionId,
                missionId,
                taskId: existingTask.id,
                sourceSystem: 'antonia-trigger',
                sourceRoute: '/api/antonia/trigger',
                requestId,
                correlationId: requestId,
                operationId: initialTaskIdempotencyKey,
                idempotencyKey: initialTaskIdempotencyKey,
                status: existingTask.status,
                outcome: 'idempotent_replay',
                payload: { taskType: existingTask.type },
            });
            return NextResponse.json({
                success: true,
                taskId: existingTask.id,
                reused: true,
                message: 'Mission task already exists',
            });
        }

        // Create initial task (SEARCH or GENERATE_CAMPAIGN)
        const { data: task, error: taskError } = await supabase
            .from('antonia_tasks')
            .insert({
                mission_id: missionId,
                organization_id: mission.organization_id,
                type: initialTaskType,
                status: 'pending',
                payload: {
                    userId: mission.user_id,
                    jobTitle: mission.params.jobTitle,
                    location: mission.params.location,
                    industry: mission.params.industry,
                    keywords: mission.params.keywords || '',
                    companySize: mission.params.companySize || '',
                    seniorities: mission.params.seniorities || [],
                    idealCustomerProfile: mission.params.idealCustomerProfile || '',
                    valueProposition: mission.params.valueProposition || '',
                    applyIcpFilter: mission.params?.applyIcpFilter !== false,
                    enrichmentLevel: mission.params.enrichmentLevel,
                    campaignName: mission.params.campaignName,
                    campaignContext: mission.params.campaignContext || '',
                    missionTitle: mission.title
                },
                    idempotency_key: initialTaskIdempotencyKey,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (taskError) {
            console.error('[Trigger] Error creating task:', {
                code: taskError.code,
                message: taskError.message,
                details: taskError.details,
                hint: taskError.hint
            });
            return NextResponse.json({
                error: 'Failed to create task',
                details: taskError.message
            }, { status: 500 });
        }

        // Log the trigger
        await supabase.from('antonia_logs').insert({
            mission_id: missionId,
            organization_id: mission.organization_id,
            level: 'info',
            message: `Mission triggered: ${mission.title}`,
            details: { taskId: task.id },
            created_at: new Date().toISOString()
        });

        await safeAppendAntoniaEvent({
            eventType: 'mission.triggered',
            organizationId: mission.organization_id,
            actorId: user.id,
            actorType: 'user',
            entityType: 'mission',
            entityId: missionId,
            missionId,
            taskId: task.id,
            sourceSystem: 'antonia-trigger',
            sourceRoute: '/api/antonia/trigger',
            requestId,
            correlationId: requestId,
            operationId: initialTaskIdempotencyKey,
            idempotencyKey: initialTaskIdempotencyKey,
            status: 'active',
            outcome: 'task_created',
            payload: { taskType: initialTaskType },
        });
        await safeAppendAntoniaEvent({
            eventType: 'task.created',
            organizationId: mission.organization_id,
            actorId: user.id,
            actorType: 'user',
            entityType: 'task',
            entityId: task.id,
            missionId,
            taskId: task.id,
            sourceSystem: 'antonia-trigger',
            sourceRoute: '/api/antonia/trigger',
            requestId,
            correlationId: requestId,
            operationId: initialTaskIdempotencyKey,
            idempotencyKey: initialTaskIdempotencyKey,
            status: 'pending',
            outcome: 'created',
            payload: { taskType: initialTaskType },
        });

        return NextResponse.json({
            success: true,
            taskId: task.id,
            message: 'Mission task created successfully'
        });

    } catch (e: any) {
        console.error('[Trigger] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
