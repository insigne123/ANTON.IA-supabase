-- Query 4: Detailed view of SEARCH tasks today
SELECT 
    id,
    mission_id,
    status,
    created_at,
    result::jsonb->>'reason' as skip_reason,
    result::jsonb->>'skipped' as was_skipped
FROM antonia_tasks
WHERE type = 'SEARCH'
  AND created_at::date = CURRENT_DATE
ORDER BY created_at DESC
LIMIT 10;
