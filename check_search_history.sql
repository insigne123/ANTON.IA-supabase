-- Ver todas las tareas SEARCH de los últimos 7 días
SELECT 
    DATE(created_at) as task_date,
    COUNT(*) as total_tasks,
    SUM(CASE WHEN result::jsonb->>'skipped' = 'true' THEN 1 ELSE 0 END) as skipped_tasks,
    SUM(CASE WHEN result::jsonb->>'skipped' != 'true' OR result::jsonb->>'skipped' IS NULL THEN 1 ELSE 0 END) as executed_tasks
FROM antonia_tasks
WHERE type = 'SEARCH'
  AND created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY task_date DESC;
