-- Diagnóstico completo del sistema de cuotas
-- Este script muestra los límites configurados vs el uso actual

-- 1. Ver los límites configurados en las misiones activas
SELECT 
    m.id as mission_id,
    m.name as mission_name,
    m.daily_search_limit,
    m.daily_enrich_limit,
    m.daily_investigate_limit,
    m.daily_contact_limit,
    m.status,
    m.created_at
FROM antonia_missions m
WHERE m.status = 'active'
ORDER BY m.created_at DESC
LIMIT 5;

-- 2. Ver el uso registrado HOY en antonia_daily_usage
SELECT 
    du.organization_id,
    du.date,
    du.search_count,
    du.enrich_count,
    du.investigate_count,
    du.contact_count,
    du.created_at,
    du.updated_at
FROM antonia_daily_usage du
WHERE du.date = CURRENT_DATE
ORDER BY du.updated_at DESC;

-- 3. Contar tareas completadas HOY por tipo
SELECT 
    type,
    status,
    COUNT(*) as total,
    MIN(created_at) as primera,
    MAX(created_at) as ultima
FROM antonia_tasks
WHERE DATE(created_at) = CURRENT_DATE
GROUP BY type, status
ORDER BY type, status;

-- 4. Ver tareas CONTACT específicamente
SELECT 
    id,
    status,
    created_at,
    scheduled_for,
    payload->>'campaignName' as campana,
    error_message
FROM antonia_tasks
WHERE type = 'CONTACT'
  AND DATE(created_at) = CURRENT_DATE
ORDER BY created_at DESC
LIMIT 20;

-- 5. Verificar si hay múltiples registros de uso para la misma fecha
SELECT 
    organization_id,
    date,
    COUNT(*) as registros_duplicados
FROM antonia_daily_usage
GROUP BY organization_id, date
HAVING COUNT(*) > 1;
