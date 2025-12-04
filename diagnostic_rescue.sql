-- Rescue Diagnostic Script
-- Run this to find WHERE your leads are hiding.

SELECT 
    l.id as lead_id, 
    l.name as lead_name, 
    l.organization_id, 
    o.name as org_name,
    l.user_id
FROM leads l
LEFT JOIN organizations o ON l.organization_id = o.id
WHERE l.user_id = auth.uid();

-- Count summary
SELECT 
    COALESCE(o.name, 'NO ORGANIZATION (NULL)') as organization_name,
    count(*) as lead_count
FROM leads l
LEFT JOIN organizations o ON l.organization_id = o.id
WHERE l.user_id = auth.uid()
GROUP BY o.name;

-- Check Enriched Leads too
SELECT 
    COALESCE(o.name, 'NO ORGANIZATION (NULL)') as organization_name,
    count(*) as enriched_lead_count
FROM enriched_leads l
LEFT JOIN organizations o ON l.organization_id = o.id
WHERE l.user_id = auth.uid()
GROUP BY o.name;
