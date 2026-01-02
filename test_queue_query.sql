-- Verificar si la query de la cola encuentra leads
-- Esta es la misma query que usa executeEnrichment

SELECT 
    id,
    name,
    company,
    status,
    mission_id,
    created_at
FROM leads
WHERE mission_id = 'ae1ec765-84ab-4906-b7b8-e3862273d630'
AND status = 'saved'
LIMIT 10;

-- También verificar el conteo
SELECT COUNT(*) as total_saved_leads
FROM leads
WHERE mission_id = 'ae1ec765-84ab-4906-b7b8-e3862273d630'
AND status = 'saved';
