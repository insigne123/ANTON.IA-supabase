-- Check recent INVESTIGATE tasks to see if they completed successfully
SELECT 
    id,
    type,
    status,
    created_at,
    processing_started_at,
    completed_at,
    error_message,
    result::jsonb->'investigations'->0->'research'->>'source' as research_source,
    result::jsonb->'investigations'->0->'research'->>'overview' as research_overview
FROM antonia_tasks
WHERE type = 'INVESTIGATE'
ORDER BY created_at DESC
LIMIT 5;

-- Check if userContext is being populated correctly in recent tasks
SELECT 
    id,
    created_at,
    payload::jsonb->'userId' as user_id_in_payload,
    payload::jsonb->'userContext' as user_context
FROM antonia_tasks
WHERE type = 'INVESTIGATE'
ORDER BY created_at DESC
LIMIT 3;
