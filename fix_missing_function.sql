-- Create the missing function to trigger daily execution
-- This function is required for the force-run script to work.

-- 1. Enable pg_net extension for HTTP requests (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Create or Replace the function
CREATE OR REPLACE FUNCTION trigger_antonia_daily_execution()
RETURNS void AS $$
DECLARE
    cloud_function_url text;
    response_id uuid;
BEGIN
    -- This is the URL of your deployed Cloud Function 'antoniaTick'
    cloud_function_url := 'https://us-central1-leadflowai-3yjcy.cloudfunctions.net/antoniaTick';
    
    -- Make HTTP POST request to Cloud Function using pg_net
    -- We use http_post (or net.http_post depending on extension version, usually just http_post in supabase wrapper)
    -- Actually, Supabase uses net.http_post
    
    PERFORM net.http_post(
        url := cloud_function_url,
        body := '{"trigger": "daily_cron"}'::jsonb,
        headers := '{"Content-Type": "application/json"}'::jsonb
    );
    
    -- Log the execution
    RAISE NOTICE 'Daily cron triggered for URL: %', cloud_function_url;
    
EXCEPTION WHEN OTHERS THEN
    -- Log any errors
    RAISE WARNING 'Error executing daily cron trigger: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
