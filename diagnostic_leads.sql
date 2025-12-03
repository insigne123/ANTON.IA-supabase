-- Diagnostic Script for Leads Visibility

-- 1. Count total leads vs leads with organization_id
SELECT 
    count(*) as total_leads,
    count(organization_id) as leads_with_org,
    count(*) FILTER (WHERE organization_id IS NULL) as leads_without_org
FROM leads;

-- 2. Show a sample of leads (first 5) to check ownership
SELECT id, user_id, organization_id, name, created_at 
FROM leads 
LIMIT 5;

-- 3. Check RLS policies for 'leads' table
SELECT 
    policyname, 
    permissive, 
    roles, 
    cmd, 
    qual, 
    with_check 
FROM 
    pg_policies 
WHERE 
    tablename = 'leads';

-- 4. Check if current user is in an organization
SELECT * FROM organization_members WHERE user_id = auth.uid();
