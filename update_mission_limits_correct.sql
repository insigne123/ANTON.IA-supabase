-- Actualizar los límites de la misión activa a valores CORRECTOS
-- Ahora entendiendo que search_limit = número de BÚSQUEDAS, no leads

UPDATE antonia_missions
SET 
    daily_search_limit = 10,         -- 10 búsquedas por día (cada una trae ~100 leads = 1000 leads/día)
    daily_enrich_limit = 100,        -- 100 enriquecimientos por día
    daily_investigate_limit = 50,    -- 50 investigaciones por día
    daily_contact_limit = 50         -- 50 contactos por día
WHERE status = 'active'
  AND id = (
    SELECT id 
    FROM antonia_missions 
    WHERE status = 'active' 
    ORDER BY created_at DESC 
    LIMIT 1
  );

-- Verificar que se actualizó
SELECT 
    id,
    daily_search_limit as busquedas_por_dia,
    daily_enrich_limit as enrich_por_dia,
    daily_investigate_limit as investigate_por_dia,
    daily_contact_limit as contact_por_dia,
    status
FROM antonia_missions
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 1;
