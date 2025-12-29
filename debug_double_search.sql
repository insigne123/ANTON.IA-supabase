-- Ver configuración de la misión "Prueba 32"
SELECT 
    id,
    title,
    daily_search_limit,
    daily_enrich_limit,
    daily_investigate_limit,
    params
FROM antonia_missions
WHERE title LIKE '%Prueba 32%'
ORDER BY created_at DESC
LIMIT 1;

-- Ver cuántas tareas SEARCH se crearon para esta misión
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
AND type = 'SEARCH'
ORDER BY created_at;
