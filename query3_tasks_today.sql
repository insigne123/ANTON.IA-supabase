-- Query 3: Check all tasks created today
SELECT 
    type,
    status,
    COUNT(*) as task_count,
    MIN(created_at) as first_task,
    MAX(created_at) as last_task
FROM antonia_tasks
WHERE created_at::date = CURRENT_DATE
GROUP BY type, status
ORDER BY type, status;
