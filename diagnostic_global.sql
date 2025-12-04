-- Global Diagnostic Script
-- Check if ANY leads exist in the entire database, regardless of owner.

SELECT count(*) as total_leads_in_db FROM leads;
SELECT count(*) as total_enriched_leads_in_db FROM enriched_leads;

-- If there are leads, show us a few to see who owns them
SELECT id, user_id, organization_id, name, created_at 
FROM leads 
LIMIT 5;
