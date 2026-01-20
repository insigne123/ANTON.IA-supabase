-- Verification Script: Check Reporting System Health
-- Run this script to verify that the reporting system is working correctly

-- 1. Check if leads_contacted column exists
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'antonia_daily_usage'
ORDER BY ordinal_position;

-- 2. View today's metrics for all organizations
SELECT 
    organization_id,
    date,
    leads_searched,
    leads_enriched,
    leads_investigated,
    leads_contacted,
    search_runs,
    updated_at
FROM antonia_daily_usage
WHERE date = CURRENT_DATE
ORDER BY updated_at DESC;

-- 3. Count contacted leads created today (should match leads_contacted metric)
SELECT 
    organization_id,
    COUNT(*) as contacted_count,
    MIN(created_at) as first_contact,
    MAX(created_at) as last_contact
FROM contacted_leads
WHERE created_at >= CURRENT_DATE
GROUP BY organization_id
ORDER BY contacted_count DESC;

-- 4. Compare metrics vs actual records (detect discrepancies)
SELECT 
    u.organization_id,
    u.date,
    u.leads_contacted as "Metric Value",
    COALESCE(c.actual_count, 0) as "Actual Records",
    (u.leads_contacted - COALESCE(c.actual_count, 0)) as "Difference"
FROM antonia_daily_usage u
LEFT JOIN (
    SELECT 
        organization_id,
        COUNT(*) as actual_count
    FROM contacted_leads
    WHERE created_at >= CURRENT_DATE
    GROUP BY organization_id
) c ON c.organization_id = u.organization_id
WHERE u.date = CURRENT_DATE
ORDER BY u.organization_id;

-- 5. View recent ANTONIA tasks (check for CONTACT tasks)
SELECT 
    id,
    organization_id,
    type,
    status,
    payload->>'userId' as user_id,
    created_at,
    updated_at
FROM antonia_tasks
WHERE type = 'CONTACT'
AND created_at >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 20;

-- 6. Check ANTONIA config (verify daily reports are enabled)
SELECT 
    organization_id,
    daily_report_enabled,
    notification_email,
    daily_search_limit,
    daily_enrich_limit,
    daily_investigate_limit
FROM antonia_config
WHERE daily_report_enabled = true;

-- 7. View recent contacted leads with details
SELECT 
    id,
    organization_id,
    name,
    email,
    company,
    status,
    provider,
    created_at,
    sent_at
FROM contacted_leads
WHERE created_at >= CURRENT_DATE - INTERVAL '1 day'
ORDER BY created_at DESC
LIMIT 50;
