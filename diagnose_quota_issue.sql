-- Diagnostic: Why is quota being reached so quickly?

-- 1. Check current daily usage
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

-- 2. Check mission limits
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

-- 3. Check all tasks created today
SELECT 
    type,
    status,
    COUNT(*) as task_count,
    MIN(created_at) as first_task,
    MAX(created_at) as last_task
FROM antonia_tasks
WHERE created_at::date = CURRENT_DATE
GROUP BY type, status
ORDER BY type, status;

-- 4. Detailed view of SEARCH tasks today
SELECT 
    id,
    mission_id,
    status,
    created_at,
    result::jsonb->>'reason' as skip_reason,
    result::jsonb->>'skipped' as was_skipped
FROM antonia_tasks
WHERE type = 'SEARCH'
  AND created_at::date = CURRENT_DATE
ORDER BY created_at DESC
LIMIT 10;

-- 5. Check if there are multiple organizations
SELECT 
    organization_id,
    COUNT(*) as mission_count
FROM antonia_missions
WHERE status = 'active'
GROUP BY organization_id;
