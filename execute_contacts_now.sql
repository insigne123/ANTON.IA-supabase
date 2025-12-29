-- Ejecutar tareas CONTACT ahora (sin esperar hasta mañana)
UPDATE antonia_tasks
SET scheduled_for = NULL
WHERE type = 'CONTACT'
  AND status = 'pending'
  AND mission_id = (
    SELECT id FROM antonia_missions 
    WHERE title LIKE '%Prueba 32%' 
    ORDER BY created_at DESC 
    LIMIT 1
  );

-- Verificar que se actualizaron
SELECT 
    id,
    type,
    status,
    scheduled_for,
    CASE 
        WHEN scheduled_for IS NULL THEN 'Se ejecutará en 1-2 minutos'
        ELSE 'Programado para: ' || scheduled_for::text
    END as execution_status
FROM antonia_tasks
WHERE type = 'CONTACT'
  AND status = 'pending'
  AND mission_id = (
    SELECT id FROM antonia_missions 
    WHERE title LIKE '%Prueba 32%' 
    ORDER BY created_at DESC 
    LIMIT 1
  );
