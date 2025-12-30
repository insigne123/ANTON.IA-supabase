-- check_status.sql
-- Check if contacted_leads stores body
SELECT column_name FROM information_schema.columns WHERE table_name = 'contacted_leads';

-- Check if the test task exists
SELECT * FROM antonia_tasks 
WHERE type = 'INVESTIGATE' 
  AND payload->>'campaignName' = 'Investigate Re-run Test'
ORDER BY created_at DESC LIMIT 1;
