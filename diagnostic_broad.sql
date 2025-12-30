-- diagnostic_broad.sql

-- 1. Check for ANY leads with the email in question to confirm existence
SELECT id, email, mission_id, created_at 
FROM leads 
WHERE email = 'vcruz@thesheriff.cl';

-- 2. Check ANY task that has 'anon' as userId in payload (Global check)
SELECT id, type, status, payload->>'userId' as userid_in_payload, created_at, error_message
FROM antonia_tasks
WHERE payload->>'userId' = 'anon'
   OR payload->>'userId' IS NULL
ORDER BY created_at DESC
LIMIT 10;

-- 3. Check for the specific error logs we added in the cloud function
SELECT id, level, message, created_at
FROM antonia_logs
WHERE message ILIKE '%Invalid User Context%'
   OR message ILIKE '%CRITICAL%'
   OR message ILIKE '%anon%'
ORDER BY created_at DESC
LIMIT 10;

-- 4. Check the latest INVESTIGATE tasks to see what they have
SELECT id, status, payload->>'userId' as userid, created_at
FROM antonia_tasks
WHERE type = 'INVESTIGATE'
ORDER BY created_at DESC
LIMIT 5;
