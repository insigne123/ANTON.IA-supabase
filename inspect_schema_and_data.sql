-- Inspect schema of antonia_missions to check for user_id vs created_by
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'antonia_missions'
AND column_name IN ('user_id', 'created_by');

-- Inspect schema of organizations to check for rich profile fields
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'organizations';

-- Inspect schema of profiles
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'profiles';

-- Inspect schema of antonia_config
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'antonia_config';


-- Check data of the most recent mission to see popluated fields
SELECT id, title, user_id, created_by, organization_id
FROM antonia_missions
ORDER BY created_at DESC
LIMIT 1;

-- Check organization data for that mission
-- (Using a CTE to pick the org id from above would be nice, but simple select is safer for arbitrary execution contexts)
-- We will just check 1 organization
SELECT * FROM organizations LIMIT 1;
