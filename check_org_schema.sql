-- Check columns of organizations table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'organizations';

-- Check if there is any other table that might hold company info
SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename LIKE '%company%';
