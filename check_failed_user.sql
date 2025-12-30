-- check_failed_user.sql

-- 1. Check Profile Compliance for the used User ID
SELECT 
    id, 
    full_name, 
    company_name, 
    job_title,
    signatures->>'profile_extended' as extended_profile
FROM profiles 
WHERE id = '07a03fba-43b2-4457-8d15-865253ef1837';

-- 2. Check recent Error logs (last 10)
SELECT created_at, level, message, details 
FROM antonia_logs 
WHERE level = 'error' 
ORDER BY created_at DESC 
LIMIT 5;
