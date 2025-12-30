-- check_user_profile.sql
SELECT 
    id, 
    full_name, 
    company_name, 
    company_domain, 
    job_title, 
    signatures 
FROM profiles 
WHERE id = 'de3a3194-29b1-449a-828a-53608a7ebe47';
