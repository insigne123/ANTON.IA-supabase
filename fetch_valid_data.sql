-- fetch_valid_data.sql
-- Get a valid user ID (limit 1)
SELECT id, full_name, company_name FROM profiles LIMIT 1;

-- Get a lead that has both email and company
SELECT id, email, name, company 
FROM leads 
WHERE email IS NOT NULL AND company IS NOT NULL 
LIMIT 1;
