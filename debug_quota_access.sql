-- Debug Script: Check why Quota API might fail

-- 1. Check if the current user has an organization member entry
-- Replace 'user_id_here' with the actual user ID if running manually, 
-- but here we just list all members to see if table is populated.
SELECT * FROM organization_members LIMIT 5;

-- 2. Check RLS policies on antonia_daily_usage
SELECT as_permit, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'antonia_daily_usage';

-- 3. Check RLS on organization_members
SELECT as_permit, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'organization_members';

-- 4. Check contents of antonia_daily_usage for today
SELECT * FROM antonia_daily_usage WHERE date = CURRENT_DATE;

-- 5. Check antonia_missions RLS
SELECT as_permit, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'antonia_missions';
