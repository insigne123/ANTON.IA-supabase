import * as functions from 'firebase-functions/v2';
import { createClient } from '@supabase/supabase-js';
// Note: In a real functions directory, you'd need to install @supabase/supabase-js and compile TS.
// This file assumes the context of a Firebase Functions environment.

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// --- WORKER LOGIC ---

async function processTask(task: any) {
    console.log(`[Worker] Processing task ${task.id} (${task.type})`);

    // 1. Mark as processing
    await supabase.from('antonia_tasks').update({ status: 'processing', processing_started_at: new Date() }).eq('id', task.id);

    try {
        let result = {};

        // 2. Execute Logic based on Type
        switch (task.type) {
            case 'SEARCH':
                // Call Apify / N8N / Leads Service
                // const leads = await leadsService.search(task.payload);
                // await leadsStorage.save(leads);
                result = { message: 'Simulated Search Completed', count: 10 };
                break;

            case 'ENRICH':
                // Call Enrichment Service
                result = { message: 'Simulated Enrichment Completed' };
                break;

            case 'CONTACT':
                // Use TokenManager to get access token -> Send Email via Gmail API
                // const token = await tokenManager.getFreshAccessToken(task.payload.userId, 'google');
                // await gmailService.send(token, ...);
                result = { message: 'Simulated Email Sent' };
                break;

            case 'REPORT':
                // Call Notification Service
                // await notificationService.sendDailyReport(task.organization_id);
                result = { message: 'Report Sent' };
                break;
        }

        // 3. Mark as Completed
        await supabase.from('antonia_tasks').update({
            status: 'completed',
            result: result,
            updated_at: new Date()
        }).eq('id', task.id);

        // 4. Log Success
        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            level: 'success',
            message: `Task ${task.type} completed successfully.`,
            details: result
        });

    } catch (e: any) {
        console.error(`[Worker] Task ${task.id} Failed`, e);
        await supabase.from('antonia_tasks').update({
            status: 'failed',
            error_message: e.message,
            updated_at: new Date()
        }).eq('id', task.id);

        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            level: 'error',
            message: `Task ${task.type} failed: ${e.message}`
        });
    }
}

/**
 * Scheduled Function: Runs every minute
 * "Tick" for the agent.
 */
export const antoniaTick = functions.scheduler.onSchedule('every 1 minutes', async () => {
    console.log('[AntoniaTick] waking up...');

    // 1. Fetch pending tasks (Concurrency Safe-ish, though basic here)
    // For robust locking use a proper RPC function: select_next_task()
    // Here we just grab 5 pending tasks.
    const { data: tasks, error } = await supabase
        .from('antonia_tasks')
        .select('*')
        .eq('status', 'pending')
        .limit(5);

    if (error) {
        console.error('Error fetching tasks', error);
        return;
    }

    if (!tasks || tasks.length === 0) {
        console.log('[AntoniaTick] No pending tasks.');
        return;
    }

    // 2. Process in parallel
    await Promise.all(tasks.map(t => processTask(t)));
});
