-- Pre-Deploy: Agregar columna retry_count si no existe
-- Esta columna es necesaria para el sistema de retry logic

ALTER TABLE antonia_tasks 
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Verificar que se agregó
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'antonia_tasks' 
  AND column_name = 'retry_count';

-- Resultado esperado:
-- column_name  | data_type | column_default
-- retry_count  | integer   | 0
