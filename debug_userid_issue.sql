-- Check if the user profile exists and has correct data
SELECT 
    id,
    full_name,
    first_name,
    last_name,
    job_title,
    organization_id
FROM profiles
WHERE id = 'de3a3194-29b1-449a-828a-53608a7ebe47';

-- Check recent tasks to see what userId is being used
SELECT 
    id,
    type,
    mission_id,
    payload::jsonb->'userId' as payload_user_id,
    created_at
FROM antonia_tasks
WHERE created_at::date = CURRENT_DATE
ORDER BY created_at DESC
LIMIT 5;
