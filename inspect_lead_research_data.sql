-- Inspeccionar los datos de investigación guardados en los leads
-- para ver si el parsing está funcionando

-- Ver los IDs de los leads investigados más recientemente
WITH recent_investigate AS (
    SELECT 
        payload->'leads' as leads_payload,
        created_at
    FROM antonia_tasks
    WHERE type = 'INVESTIGATE' 
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
)
SELECT 
    l.id,
    l.name,
    l.company,
    l.email,
    l.created_at,
    -- Intentar acceder a diferentes posibles ubicaciones del research data
    l.data->'research' as research_in_data,
    l.data as full_data
FROM leads l
WHERE l.id IN (
    SELECT (jsonb_array_elements(leads_payload)->>'id')::uuid
    FROM recent_investigate
)
ORDER BY l.created_at DESC;
