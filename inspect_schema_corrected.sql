-- Inspect schema of antonia_missions to confirm user_id exists
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'antonia_missions'
ORDER BY column_name;

-- Inspect schema of organizations to see available fields
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'organizations'
ORDER BY column_name;

-- Inspect schema of profiles to see available fields
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY column_name;

-- Check data of the most recent mission (safely)
SELECT id, title, user_id, organization_id, created_at
FROM antonia_missions
ORDER BY created_at DESC
LIMIT 1;
