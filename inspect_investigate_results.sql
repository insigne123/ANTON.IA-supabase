-- Inspeccionar resultados de tareas INVESTIGATE para ver qué devuelve N8N
-- Esto nos ayudará a entender por qué "No summary available"

-- 1. Ver las últimas 3 tareas INVESTIGATE completadas
SELECT 
    id,
    created_at,
    status,
    payload->>'userId' as user_id,
    result->'investigatedCount' as investigated_count,
    result->'investigations' as investigations_summary
FROM antonia_tasks
WHERE type = 'INVESTIGATE' 
  AND status = 'completed'
ORDER BY created_at DESC
LIMIT 3;

-- 2. Ver el payload completo de la tarea INVESTIGATE más reciente
-- Esto mostrará qué leads se enviaron a N8N
SELECT 
    id,
    created_at,
    payload
FROM antonia_tasks
WHERE type = 'INVESTIGATE' 
  AND status = 'completed'
ORDER BY created_at DESC
LIMIT 1;

-- 3. Buscar en la tabla de leads los datos de investigación guardados
-- (Si es que se guardaron en algún campo research o similar)
SELECT 
    l.id,
    l.name,
    l.company,
    l.email,
    l.created_at
FROM leads l
WHERE l.mission_id IN (
    SELECT mission_id 
    FROM antonia_tasks 
    WHERE type = 'INVESTIGATE' 
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
)
ORDER BY l.created_at DESC
LIMIT 10;
