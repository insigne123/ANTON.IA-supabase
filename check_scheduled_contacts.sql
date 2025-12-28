-- Verificar cuándo están programados los contactos pendientes
SELECT 
    id,
    type,
    status,
    scheduled_for,
    scheduled_for AT TIME ZONE 'America/Santiago' as hora_local_chile,
    created_at,
    payload->>'campaignName' as campana
FROM antonia_tasks
WHERE type = 'CONTACT' 
  AND status = 'pending'
ORDER BY scheduled_for DESC
LIMIT 10;
