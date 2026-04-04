
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    console.log('--- Checking Recent Logs ---');

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: logs } = await supabase
        .from('antonia_logs')
        .select('*')
        .gte('created_at', fiveMinutesAgo)
        .order('created_at', { ascending: true });

    if (!logs || logs.length === 0) {
        console.log('No logs found.');
        return;
    }

    // Print logs that look relevant
    console.log(`Found ${logs.length} logs.`);
    for (const log of logs.reverse()) { // Print chronological
        const msg = (log.message || '').toLowerCase();
        if (msg.includes('cron') || msg.includes('fallback') || msg.includes('search') || msg.includes('reserve')) {
            console.log(`[${log.created_at}] [${log.level}] ${log.message}`);
        }
    }
}
check();
