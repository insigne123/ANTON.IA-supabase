-- Query 1: Check current daily usage
SELECT 
    organization_id,
    date,
    search_runs,
    leads_searched,
    leads_enriched,
    leads_investigated,
    updated_at
FROM antonia_daily_usage
WHERE date = CURRENT_DATE
ORDER BY updated_at DESC;
