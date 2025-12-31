-- Verificación Específica: Leads de Misiones Activas
-- Este script verifica si las misiones están guardando leads correctamente

-- 1. Ver misiones activas y sus tareas recientes
SELECT 
    m.id as mission_id,
    m.title,
    m.status,
    m.created_at as mission_created,
    COUNT(DISTINCT t.id) FILTER (WHERE t.type = 'SEARCH' AND t.created_at > NOW() - INTERVAL '7 days') as search_tasks_7d,
    COUNT(DISTINCT t.id) FILTER (WHERE t.type = 'ENRICH' AND t.created_at > NOW() - INTERVAL '7 days') as enrich_tasks_7d
FROM antonia_missions m
LEFT JOIN antonia_tasks t ON t.mission_id = m.id
WHERE m.status = 'active'
GROUP BY m.id, m.title, m.status, m.created_at
ORDER BY m.created_at DESC;

-- 2. Ver leads creados POR misiones (con mission_id)
SELECT 
    m.title as mission_title,
    l.mission_id,
    COUNT(*) as total_leads,
    COUNT(*) FILTER (WHERE l.status = 'saved') as saved_leads,
    COUNT(*) FILTER (WHERE l.status = 'enriched') as enriched_leads,
    MIN(l.created_at) as first_lead,
    MAX(l.created_at) as last_lead
FROM leads l
INNER JOIN antonia_missions m ON l.mission_id = m.id
GROUP BY m.title, l.mission_id
ORDER BY MAX(l.created_at) DESC;

-- 3. Ver los últimos 20 leads CON mission_id (deberían ser de misiones)
SELECT 
    l.id,
    l.name,
    l.company,
    l.status,
    m.title as mission_title,
    l.created_at
FROM leads l
INNER JOIN antonia_missions m ON l.mission_id = m.id
ORDER BY l.created_at DESC
LIMIT 20;

-- 4. Ver tareas SEARCH completadas recientemente y sus resultados
SELECT 
    t.id as task_id,
    m.title as mission_title,
    t.status,
    t.result->>'leadsFound' as leads_found,
    t.created_at,
    t.updated_at,
    -- Contar leads creados después de esta tarea con el mission_id
    (SELECT COUNT(*) FROM leads l 
     WHERE l.mission_id = t.mission_id 
     AND l.created_at >= t.created_at 
     AND l.created_at <= t.updated_at + INTERVAL '5 minutes') as leads_inserted
FROM antonia_tasks t
INNER JOIN antonia_missions m ON t.mission_id = m.id
WHERE t.type = 'SEARCH'
AND t.created_at > NOW() - INTERVAL '7 days'
ORDER BY t.created_at DESC
LIMIT 10;

-- 5. Verificar si hay ENRICH tasks desde cola (source: 'queue')
SELECT 
    t.id,
    m.title as mission_title,
    t.status,
    t.payload->>'source' as source,
    t.payload->>'queueCount' as queue_count,
    t.created_at
FROM antonia_tasks t
INNER JOIN antonia_missions m ON t.mission_id = m.id
WHERE t.type = 'ENRICH'
AND t.created_at > NOW() - INTERVAL '7 days'
ORDER BY t.created_at DESC
LIMIT 10;

-- 6. DIAGNÓSTICO: Si no hay leads con mission_id, verificar si hay misiones activas
SELECT 
    'Misiones Activas' as check_name,
    COUNT(*) as count
FROM antonia_missions 
WHERE status = 'active'
UNION ALL
SELECT 
    'Leads con mission_id (últimos 7 días)' as check_name,
    COUNT(*) as count
FROM leads 
WHERE mission_id IS NOT NULL 
AND created_at > NOW() - INTERVAL '7 days'
UNION ALL
SELECT 
    'Tareas SEARCH (últimos 7 días)' as check_name,
    COUNT(*) as count
FROM antonia_tasks 
WHERE type = 'SEARCH' 
AND created_at > NOW() - INTERVAL '7 days';
