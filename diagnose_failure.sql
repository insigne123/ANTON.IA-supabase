-- diagnose_failure.sql
-- 1. Check if there are any error logs in antonia_logs (if table exists)
-- 2. Check the profile used in the test to see if it meets validation requirements.

-- Check logs for the failed task (assuming antonia_logs exists and links to task or has recent logs)
SELECT * FROM antonia_logs 
ORDER BY created_at DESC 
LIMIT 5;

-- Check the profile that likely was picked (the first one)
SELECT id, full_name, company_name, job_title, signatures 
FROM profiles 
LIMIT 1;

-- Check the task payload again to see exactly what userId was sent
SELECT payload->>'userId' as used_user_id 
FROM antonia_tasks 
WHERE type = 'ENRICH' 
  AND payload->>'campaignName' = 'Full Flow Dry Run Test'
ORDER BY created_at DESC
LIMIT 1;
