-- Diagnóstico corregido del sistema de cuotas

-- 1. Ver todas las columnas de antonia_missions para saber qué campos existen
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'antonia_missions'
ORDER BY ordinal_position;

-- 2. Ver los límites configurados en las misiones activas (sin columna 'name')
SELECT 
    m.id as mission_id,
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

-- 3. Ver el uso registrado HOY en antonia_daily_usage
SELECT 
    du.*
FROM antonia_daily_usage du
WHERE du.date = CURRENT_DATE
ORDER BY du.updated_at DESC;

-- 4. Contar tareas completadas HOY por tipo
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

-- 5. Ver cuántos leads se contactaron HOY (tabla contacted_leads)
SELECT 
    COUNT(*) as total_contactados_hoy,
    MIN(created_at) as primer_contacto,
    MAX(created_at) as ultimo_contacto
FROM contacted_leads
WHERE DATE(created_at) = CURRENT_DATE;

-- 6. Comparar límites vs uso actual
WITH mission_limits AS (
    SELECT 
        daily_search_limit,
        daily_enrich_limit,
        daily_investigate_limit,
        daily_contact_limit
    FROM antonia_missions
    WHERE status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
),
daily_counts AS (
    SELECT 
        COALESCE(leads_searched, 0) as searches,
        COALESCE(leads_enriched, 0) as enriched,
        COALESCE(leads_investigated, 0) as investigated
    FROM antonia_daily_usage
    WHERE date = CURRENT_DATE
    LIMIT 1
),
contact_count AS (
    SELECT COUNT(*) as contacted
    FROM contacted_leads
    WHERE DATE(created_at) = CURRENT_DATE
)
SELECT 
    'Search' as tipo,
    dc.searches as uso_actual,
    ml.daily_search_limit as limite,
    (ml.daily_search_limit - dc.searches) as restante
FROM mission_limits ml, daily_counts dc
UNION ALL
SELECT 
    'Enrich' as tipo,
    dc.enriched as uso_actual,
    ml.daily_enrich_limit as limite,
    (ml.daily_enrich_limit - dc.enriched) as restante
FROM mission_limits ml, daily_counts dc
UNION ALL
SELECT 
    'Investigate' as tipo,
    dc.investigated as uso_actual,
    ml.daily_investigate_limit as limite,
    (ml.daily_investigate_limit - dc.investigated) as restante
FROM mission_limits ml, daily_counts dc
UNION ALL
SELECT 
    'Contact' as tipo,
    cc.contacted as uso_actual,
    ml.daily_contact_limit as limite,
    (ml.daily_contact_limit - cc.contacted) as restante
FROM mission_limits ml, contact_count cc;
