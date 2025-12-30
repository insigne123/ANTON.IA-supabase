-- Ver todas las tareas de la misión "Prueba 32" para ver si hay duplicados
SELECT 
    id,
    type,
    status,
    created_at,
    payload::jsonb->'userId' as user_id
FROM antonia_tasks
WHERE mission_id = (
    SELECT id FROM antonia_missions 
    WHERE title LIKE '%Prueba 32%' 
    ORDER BY created_at DESC 
    LIMIT 1
)
ORDER BY created_at;
