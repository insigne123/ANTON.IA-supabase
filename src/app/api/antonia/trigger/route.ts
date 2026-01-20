import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
    try {
        // Initialize Supabase client at runtime, not at module load time
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { missionId } = await req.json();

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

        // Check for Auto Campaign Strategy
        const isAutoCampaign = mission.params.autoGenerateCampaign;
        const initialTaskType = isAutoCampaign ? 'GENERATE_CAMPAIGN' : 'SEARCH';

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
                    enrichmentLevel: mission.params.enrichmentLevel,
                    campaignName: mission.params.campaignName,
                    campaignContext: mission.params.campaignContext || '',
                    missionTitle: mission.title
                },
                idempotency_key: `mission_${missionId}_init_${Date.now()}`,
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
