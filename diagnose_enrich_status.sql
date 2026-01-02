-- Diagnóstico: Verificar si las tareas ENRICH están procesando leads
-- Este script ayuda a diagnosticar por qué los leads no se marcan como 'enriched'

-- 1. Ver detalles de las tareas ENRICH completadas
SELECT 
    t.id,
    t.mission_id,
    t.status,
    t.payload->>'source' as source,
    t.payload->>'userId' as user_id,
    t.result->>'enrichedCount' as enriched_count,
    t.result->>'skipped' as skipped,
    t.result->>'reason' as skip_reason,
    t.created_at,
    t.updated_at
FROM antonia_tasks t
WHERE t.type = 'ENRICH'
AND t.created_at > NOW() - INTERVAL '7 days'
ORDER BY t.created_at DESC
LIMIT 10;

-- 2. Ver si hay errores en las tareas
SELECT 
    t.id,
    t.type,
    t.status,
    t.error_message,
    t.created_at
FROM antonia_tasks t
WHERE t.status = 'failed'
AND t.created_at > NOW() - INTERVAL '7 days'
ORDER BY t.created_at DESC
LIMIT 10;

-- 3. Ver logs de Antonia relacionados con enriquecimiento
SELECT 
    l.id,
    l.level,
    l.message,
    l.details,
    l.created_at
FROM antonia_logs l
WHERE l.message ILIKE '%enrich%'
AND l.created_at > NOW() - INTERVAL '7 days'
ORDER BY l.created_at DESC
LIMIT 20;

-- 4. Verificar si la columna 'last_enriched_at' existe
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'leads' 
AND column_name = 'last_enriched_at';

-- 5. Ver uso diario de enriquecimiento
SELECT 
    date,
    leads_enriched,
    leads_investigated
FROM antonia_daily_usage
WHERE date > CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC;
