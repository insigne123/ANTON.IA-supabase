import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(req: NextRequest) {
    try {
        const { missionId } = await req.json();

        if (!missionId) {
            return NextResponse.json({ error: 'missionId required' }, { status: 400 });
        }

        // Get mission details
        const { data: mission, error: missionError } = await supabase
            .from('antonia_missions')
            .select('*')
            .eq('id', missionId)
            .single();

        if (missionError || !mission) {
            return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
        }

        // Create initial SEARCH task
        const { data: task, error: taskError } = await supabase
            .from('antonia_tasks')
            .insert({
                mission_id: missionId,
                organization_id: mission.organization_id,
                type: 'SEARCH',
                status: 'pending',
                payload: {
                    userId: mission.user_id,
                    jobTitle: mission.params.jobTitle,
                    location: mission.params.location,
                    industry: mission.params.industry,
                    keywords: mission.params.keywords,
                    enrichmentLevel: mission.params.enrichmentLevel,
                    campaignName: mission.params.campaignName
                },
                idempotency_key: `mission_${missionId}_search_${Date.now()}`,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (taskError) {
            console.error('[Trigger] Error creating task:', taskError);
            return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
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
