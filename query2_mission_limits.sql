-- Query 2: Check mission limits
SELECT 
    id,
    title,
    status,
    daily_search_limit,
    daily_enrich_limit,
    daily_investigate_limit,
    daily_contact_limit,
    created_at
FROM antonia_missions
WHERE status = 'active'
ORDER BY created_at DESC;
