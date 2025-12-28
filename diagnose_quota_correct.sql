-- Diagnóstico CORRECTO del sistema de cuotas
-- Mostrando search_runs (búsquedas) en vez de leads_searched (leads individuales)

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
        COALESCE(search_runs, 0) as search_operations,      -- CORRECTO: búsquedas, no leads
        COALESCE(leads_searched, 0) as total_leads,         -- Info adicional
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
    'Search (Operaciones)' as tipo,
    dc.search_operations as uso_actual,
    ml.daily_search_limit as limite,
    (ml.daily_search_limit - dc.search_operations) as restante,
    dc.total_leads as leads_totales
FROM mission_limits ml, daily_counts dc
UNION ALL
SELECT 
    'Enrich' as tipo,
    dc.enriched as uso_actual,
    ml.daily_enrich_limit as limite,
    (ml.daily_enrich_limit - dc.enriched) as restante,
    NULL as leads_totales
FROM mission_limits ml, daily_counts dc
UNION ALL
SELECT 
    'Investigate' as tipo,
    dc.investigated as uso_actual,
    ml.daily_investigate_limit as limite,
    (ml.daily_investigate_limit - dc.investigated) as restante,
    NULL as leads_totales
FROM mission_limits ml, daily_counts dc
UNION ALL
SELECT 
    'Contact' as tipo,
    cc.contacted as uso_actual,
    ml.daily_contact_limit as limite,
    (ml.daily_contact_limit - cc.contacted) as restante,
    NULL as leads_totales
FROM mission_limits ml, contact_count cc;
