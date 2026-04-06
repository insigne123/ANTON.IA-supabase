-- Rescue Orphaned Data
-- This script "reclaims" data for users if they are no longer members of the organization the data is assigned to.
-- It sets organization_id = NULL, making the data "Personal" again.

-- 1. Leads
UPDATE leads l
SET organization_id = NULL
WHERE organization_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 
    FROM organization_members om 
    WHERE om.organization_id = l.organization_id 
    AND om.user_id = l.user_id
);

-- 2. Enriched Leads
UPDATE enriched_leads l
SET organization_id = NULL
WHERE organization_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 
    FROM organization_members om 
    WHERE om.organization_id = l.organization_id 
    AND om.user_id = l.user_id
);

-- 3. Contacted Leads
UPDATE contacted_leads l
SET organization_id = NULL
WHERE organization_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 
    FROM organization_members om 
    WHERE om.organization_id = l.organization_id 
    AND om.user_id = l.user_id
);

-- 4. Campaigns
UPDATE campaigns c
SET organization_id = NULL
WHERE organization_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 
    FROM organization_members om 
    WHERE om.organization_id = c.organization_id 
    AND om.user_id = c.user_id
);
