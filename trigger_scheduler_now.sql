-- Trigger manual del scheduler para crear nueva tarea ENRICH con userId
-- Ejecuta esto para crear una nueva tarea con la lógica actualizada

SELECT * FROM schedule_daily_mission_tasks();

-- Luego verifica la nueva tarea creada
SELECT 
    id,
    type,
    status,
    payload->>'userId' as user_id,
    payload->>'source' as source,
    payload->>'queueCount' as queue_count,
    created_at
FROM antonia_tasks
WHERE type = 'ENRICH'
AND created_at > NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC
LIMIT 1;
