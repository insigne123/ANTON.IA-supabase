-- check_logs_schema.sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'antonia_logs';
