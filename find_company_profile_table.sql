-- Buscar todas las tablas que podrían tener datos de empresa
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
  AND (
    table_name LIKE '%company%' OR 
    table_name LIKE '%organization%' OR 
    table_name LIKE '%profile%' OR
    table_name LIKE '%business%'
  )
ORDER BY table_name;

-- Ver todas las tablas públicas
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
