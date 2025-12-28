-- Script para analizar el problema de cuotas y crear una vista consolidada

-- Primero, vamos a ver qué columnas tiene realmente la tabla antonia_daily_usage
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'antonia_daily_usage'
ORDER BY ordinal_position;

-- Ver estructura de la tabla antonia_missions para entender los límites
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'antonia_missions'
  AND column_name LIKE '%limit%'
ORDER BY ordinal_position;
