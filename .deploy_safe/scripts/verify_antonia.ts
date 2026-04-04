
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function verify() {
    console.log('--- ANTON.IA Verification Script ---');

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const cronSecret = process.env.CRON_SECRET;

    console.log(`URL: ${url ? 'OK' : 'MISSING'}`);
    console.log(`Service Key: ${serviceKey ? 'OK' : 'MISSING'}`);
    console.log(`Cron Secret: ${cronSecret ? 'Found' : 'MISSING'}`);

    if (!url || !serviceKey) {
        console.error('❌ Cannot run verification: Missing Supabase Credentials.');
        console.log('Please add SUPABASE_SERVICE_ROLE_KEY to .env.local');
        return;
    }

    if (!cronSecret) {
        console.error('❌ Missing CRON_SECRET. API call will fail.');
        return;
    }

    const supabase = createClient(url, serviceKey);

    // 1. Check Connection
    const { data: orgs, error } = await supabase.from('organizations').select('count').limit(1);
    if (error) {
        console.error('❌ Supabase Connection Failed:', error.message);
        return;
    }
    console.log('✅ Supabase Connection: OK (Service Role)');

    // 2. Simulate Trigger
    console.log('\n--- Triggering Cron Job (Simulation) ---');
    const cronUrl = 'http://localhost:9003/api/cron/antonia';

    try {
        const res = await fetch(cronUrl, {
            headers: {
                'Authorization': `Bearer ${cronSecret}`,
                'x-cron-secret': cronSecret
            }
        });

        console.log(`Response Status: ${res.status}`);
        const text = await res.text();
        console.log(`Response Body: ${text.slice(0, 200)}...`);

        if (res.ok) {
            console.log('✅ Cron Route Triggered Successfully');
        } else {
            console.error('❌ Cron Route Failed');
        }
    } catch (e: any) {
        console.error('❌ Network Error (Server might not be running):', e.message);
        console.log('ensure "npm run dev" is running on port 3000');
    }

    // 3. Check Logs for Fallback
    console.log('\n--- Checking Logs for Fallback Activity ---');
    const { data: logs } = await supabase
        .from('antonia_logs')
        .select('*')
        .eq('level', 'info')
        .like('message', '%fallback%')
        .order('created_at', { ascending: false })
        .limit(5);

    if (logs && logs.length > 0) {
        console.log('✅ Found Fallback Logs:', logs);
    } else {
        console.log('ℹ️ No recent fallback logs found (Maybe no task needed it yet).');
    }
}

verify();
