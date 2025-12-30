-- debug_random_selection.sql
-- Check if we have ANY leads that match the criteria
SELECT count(*) as total_leads FROM leads;

SELECT count(*) as leads_with_company 
FROM leads 
WHERE company IS NOT NULL AND company != '';

SELECT count(*) as leads_with_email 
FROM leads 
WHERE email IS NOT NULL;

-- Try to find ONE candidate and show it
SELECT id, email, name, company 
FROM leads 
WHERE email IS NOT NULL 
LIMIT 5;
