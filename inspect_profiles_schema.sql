-- inspect_profiles_schema.sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles';
