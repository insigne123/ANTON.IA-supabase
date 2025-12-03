-- Diagnostic Script to check Database Schema and RLS Policies

-- 1. List all tables and their columns in the public schema
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable
FROM 
    information_schema.columns
WHERE 
    table_schema = 'public'
ORDER BY 
    table_name, ordinal_position;

-- 2. List all RLS Policies
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    permissive, 
    roles, 
    cmd, 
    qual, 
    with_check 
FROM 
    pg_policies 
WHERE 
    schemaname = 'public'
ORDER BY 
    tablename, policyname;

-- 3. Check for specific columns in 'profiles' table
SELECT 
    column_name, 
    data_type 
FROM 
    information_schema.columns 
WHERE 
    table_name = 'profiles' 
    AND column_name IN ('company_name', 'company_domain', 'signatures');

-- 4. Check for 'organization_invites' table
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE  table_schema = 'public'
   AND    table_name   = 'organization_invites'
);
