-- Verificando el éxito de la Misión de Prueba
-- Este script muestra el resultado de la tarea INVESTIGATE más reciente.

WITH latest_investigate AS (
    SELECT id, result, created_at 
    FROM antonia_tasks 
    WHERE type = 'INVESTIGATE' 
      AND status = 'completed'
    ORDER BY created_at DESC 
    LIMIT 1
)
SELECT 
    li.created_at as fecha_ejecucion,
    jsonb_array_elements(li.result->'investigations')->>'name' as nombre_lead,
    jsonb_array_elements(li.result->'investigations')->>'company' as empresa,
    jsonb_array_elements(li.result->'investigations')->>'summarySnippet' as resumen_investigacion
FROM latest_investigate li;
