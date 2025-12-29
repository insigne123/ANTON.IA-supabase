-- TEMPORAL: Reset del contador de hoy para poder probar
UPDATE antonia_daily_usage
SET search_runs = 0,
    leads_searched = 0,
    leads_enriched = 0,
    leads_investigated = 0
WHERE organization_id = '289b6053-6e25-434d-b212-60df44c8cc3c'
  AND date = CURRENT_DATE;

-- Verificar que se reseteó
SELECT * FROM antonia_daily_usage
WHERE organization_id = '289b6053-6e25-434d-b212-60df44c8cc3c'
  AND date = CURRENT_DATE;
