-- Crear manualmente una tarea ENRICH con userId para probar el sistema
-- Esta tarea procesará los leads pendientes de la cola

INSERT INTO antonia_tasks (
    mission_id,
    organization_id,
    type,
    status,
    payload,
    idempotency_key,
    created_at
)
SELECT 
    m.id,
    m.organization_id,
    'ENRICH',
    'pending',
    jsonb_build_object(
        'userId', m.params->>'userId',
        'source', 'queue',
        'queueCount', (SELECT COUNT(*) FROM leads WHERE mission_id = m.id AND status = 'saved'),
        'enrichmentLevel', m.params->>'enrichmentLevel',
        'campaignName', m.params->>'campaignName'
    ),
    'manual_test_enrich_' || NOW()::text,
    NOW()
FROM antonia_missions m
WHERE m.id = 'ae1ec765-84ab-4906-b7b8-e3862273d630';

-- Verificar que se creó correctamente
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
ORDER BY created_at DESC
LIMIT 1;
