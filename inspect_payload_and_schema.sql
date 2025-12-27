-- Check recent INVESTIGATE tasks to see their payloads and userId
SELECT id, type, status, payload, created_at
FROM antonia_tasks
WHERE type = 'INVESTIGATE'
ORDER BY created_at DESC
LIMIT 3;

-- Check if antonia_companies table exists and has data
SELECT to_regclass('public.antonia_companies');

-- If it exists, show columns
-- SELECT * FROM antonia_companies LIMIT 1;

-- Check organizations table as fallback
SELECT * FROM organizations LIMIT 1;
