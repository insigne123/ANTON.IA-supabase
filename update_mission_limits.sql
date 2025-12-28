-- Actualizar los límites de la misión activa a valores más razonables

UPDATE antonia_missions
SET 
    daily_search_limit = 500,        -- 500 leads por día
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
    daily_search_limit,
    daily_enrich_limit,
    daily_investigate_limit,
    daily_contact_limit,
    status
FROM antonia_missions
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 1;
