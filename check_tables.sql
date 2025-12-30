-- check_tables.sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
  AND (table_name LIKE '%domain%' OR table_name LIKE '%exclude%' OR table_name LIKE '%unsub%');
