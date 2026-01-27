
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function setup() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    console.log('--- Setting up Fallback Test ---');

    // 1. Get an active mission
    const { data: missions } = await supabase
        .from('antonia_missions')
        .select('*')
        .eq('status', 'active')
        .limit(1);

    if (!missions || missions.length === 0) {
        console.error('❌ No active missions found. Please create/activate one in the UI first.');
        return;
    }
    const mission = missions[0];
    console.log(`Using Mission: ${mission.name} (${mission.id})`);

    // 2. Insert/Reset a SEARCH task
    await supabase.from('antonia_tasks').update({ status: 'failed' }).eq('mission_id', mission.id).eq('status', 'pending');

    const { data: task, error } = await supabase
        .from('antonia_tasks')
        .insert({
            mission_id: mission.id,
            organization_id: mission.organization_id,
            type: 'SEARCH',
            status: 'pending',
            scheduled_for: new Date(Date.now() - 3600000).toISOString(),
            payload: {
                jobTitle: 'Xylophone Polisher',
                location: 'Antarctica',
                userId: mission.user_id
            }
        })
        .select()
        .single();

    if (error) {
        console.error('❌ Failed to insert test task:', error.message);
    } else {
        console.log(`✅ Created SEARCH task (${task.id}) designed to fail (0 leads).`);
    }
}
setup();
