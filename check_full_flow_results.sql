-- check_full_flow_results.sql
-- Muestra el progreso de la prueba y el EMAIL GENERADO final.

SELECT 
    type as TAREA,
    status as ESTADO,
    to_char(created_at, 'HH24:MI:SS') as HORA,
    -- Mostrar si el flag dryRun viajó correctamente
    coalesce(payload->>'dryRun', 'false') as "Modo DryRun",
    -- Para la tarea CONTACT, mostramos el borrador generado
    CASE 
        WHEN type = 'CONTACT' THEN payload->'leads'->0->'research'->'emailDraft'->>'subject'
        ELSE NULL 
    END as "ASUNTO GENERADO",
    CASE 
        WHEN type = 'CONTACT' THEN payload->'leads'->0->'research'->'emailDraft'->>'body'
        ELSE NULL 
    END as "CUERPO DEL MAIL"
FROM antonia_tasks
WHERE payload->>'campaignName' = 'Full Flow Dry Run Test'
ORDER BY created_at ASC;
