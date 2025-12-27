-- FORCE RUN: Execute Pending Tasks Immediately
-- Use this if you don't want to wait for the scheduled time (8 AM tomorrow).

-- 1. Update pending CONTACT tasks to be due "now"
UPDATE antonia_tasks
SET scheduled_for = NOW() - INTERVAL '1 minute'
WHERE type = 'CONTACT' 
  AND status = 'pending'
  AND scheduled_for > NOW();

-- 2. Trigger the Daily Execution Logic manually
-- This calls the Cloud Function via pg_net, just like the cron job would.
SELECT trigger_antonia_daily_execution();

-- 3. Verify status (Wait a few seconds after running step 2)
-- SELECT id, type, status, error_message FROM antonia_tasks WHERE type = 'CONTACT' ORDER BY created_at DESC;
