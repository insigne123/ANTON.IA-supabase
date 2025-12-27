-- =====================================================
-- SETUP DAILY CRON FOR ANTONIA MISSIONS
-- =====================================================
-- This script configures Supabase pg_cron to automatically
-- execute ANTONIA missions every day at 8:00 AM UTC
-- =====================================================

-- Step 1: Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Step 2: Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Step 3: Create function to trigger Cloud Function
CREATE OR REPLACE FUNCTION trigger_antonia_daily_execution()
RETURNS void AS $$
DECLARE
    cloud_function_url text;
    response_data jsonb;
BEGIN
    -- IMPORTANT: Replace this URL with your actual Firebase Cloud Function URL
    -- Get it by running: firebase functions:list
    -- It should look like: https://us-central1-YOUR-PROJECT.cloudfunctions.net/processAntoniaTask
    cloud_function_url := 'YOUR_CLOUD_FUNCTION_URL_HERE';
    
    -- Make HTTP POST request to Cloud Function
    SELECT content::jsonb INTO response_data
    FROM http_post(
        cloud_function_url,
        '{"trigger": "daily_cron"}'::jsonb,
        'application/json'::text
    );
    
    -- Log the execution
    RAISE NOTICE 'Daily cron executed at %. Response: %', NOW(), response_data;
    
EXCEPTION WHEN OTHERS THEN
    -- Log any errors
    RAISE WARNING 'Error executing daily cron: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Schedule the cron job to run daily at 8:00 AM UTC
-- This will execute every day and trigger the Cloud Function
SELECT cron.schedule(
    'antonia-daily-missions',           -- Job name
    '0 8 * * *',                        -- Cron expression: Every day at 8:00 AM UTC
    $$SELECT trigger_antonia_daily_execution();$$
);

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- View all scheduled cron jobs
SELECT * FROM cron.job;

-- View cron job execution history
SELECT * FROM cron.job_run_details 
WHERE jobname = 'antonia-daily-missions'
ORDER BY start_time DESC 
LIMIT 10;

-- =====================================================
-- MANUAL EXECUTION (for testing)
-- =====================================================
-- Run this to test the function manually without waiting for the cron:
-- SELECT trigger_antonia_daily_execution();

-- =====================================================
-- UNSCHEDULE (if needed)
-- =====================================================
-- To remove the cron job:
-- SELECT cron.unschedule('antonia-daily-missions');
