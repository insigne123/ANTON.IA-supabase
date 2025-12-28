-- Ver la estructura completa de antonia_daily_usage
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'antonia_daily_usage'
ORDER BY ordinal_position;

-- Ver los datos actuales
SELECT * FROM antonia_daily_usage
WHERE date = CURRENT_DATE;
