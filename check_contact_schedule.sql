-- Verificar cuándo se ejecutarán las tareas CONTACT
SELECT 
    id,
    type,
    status,
    created_at,
    scheduled_for,
    CASE 
        WHEN scheduled_for IS NULL THEN 'Se ejecutará inmediatamente'
        WHEN scheduled_for <= NOW() THEN 'Listo para ejecutar ahora'
        ELSE 'Programado para: ' || scheduled_for::text
    END as execution_time
FROM antonia_tasks
WHERE type = 'CONTACT'
  AND status = 'pending'
ORDER BY created_at DESC;
