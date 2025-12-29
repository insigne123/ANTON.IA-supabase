-- Verificar historial de daily_usage (últimos 7 días)
SELECT 
    date,
    search_runs,
    leads_searched,
    leads_enriched,
    leads_investigated,
    updated_at
FROM antonia_daily_usage
WHERE organization_id = '289b6053-6e25-434d-b212-60df44c8cc3c'
ORDER BY date DESC
LIMIT 7;
