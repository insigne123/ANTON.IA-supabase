-- fetch_good_user.sql
-- Find a user that actually has a company name
SELECT id, full_name, company_name 
FROM profiles 
WHERE company_name IS NOT NULL 
  AND company_name != 'Tu Empresa' 
  AND company_name != ''
LIMIT 1;
