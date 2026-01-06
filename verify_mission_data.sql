-- Verificar datos reales de la misión
-- Reemplaza 'MISSION_ID' con el ID de tu misión

DO $$
DECLARE
    test_mission_id uuid;
    total_leads integer;
    enriched_leads integer;
    contacted_count integer;
    leads_with_email integer;
BEGIN
    -- Obtener la misión activa (ajusta según necesites)
    SELECT id INTO test_mission_id 
    FROM antonia_missions 
    WHERE status = 'active' 
    ORDER BY created_at DESC 
    LIMIT 1;
    
    RAISE NOTICE '=== Verificación de Datos para Misión: % ===', test_mission_id;
    RAISE NOTICE '';
    
    -- 1. Total de leads encontrados
    SELECT COUNT(*) INTO total_leads
    FROM leads
    WHERE mission_id = test_mission_id;
    
    RAISE NOTICE '1. Total de Leads Encontrados: %', total_leads;
    
    -- 2. Leads enriquecidos (status='enriched')
    SELECT COUNT(*) INTO enriched_leads
    FROM leads
    WHERE mission_id = test_mission_id
    AND status = 'enriched';
    
    RAISE NOTICE '2. Leads con status=''enriched'': %', enriched_leads;
    
    -- 3. Leads contactados
    SELECT COUNT(*) INTO contacted_count
    FROM contacted_leads
    WHERE mission_id = test_mission_id;
    
    RAISE NOTICE '3. Leads Contactados (tabla contacted_leads): %', contacted_count;
    
    -- 4. Verificar si hay leads con email
    SELECT COUNT(*) INTO leads_with_email
    FROM leads
    WHERE mission_id = test_mission_id
    AND email IS NOT NULL;
    
    RAISE NOTICE '4. Leads con email (potencialmente enriquecidos): %', leads_with_email;
    
    RAISE NOTICE '';
    RAISE NOTICE '=== Diagnóstico ===';
    
    IF enriched_leads = 0 AND total_leads > 0 THEN
        RAISE NOTICE '⚠️  PROBLEMA: Hay % leads pero 0 con status=''enriched''', total_leads;
        RAISE NOTICE '   Posibles causas:';
        RAISE NOTICE '   1. Los leads no se están marcando como ''enriched'' después del enriquecimiento';
        RAISE NOTICE '   2. El campo status tiene otro valor (ej: ''saved'', ''pending'', etc.)';
    END IF;
    
    IF contacted_count = 0 AND enriched_leads > 0 THEN
        RAISE NOTICE '⚠️  PROBLEMA: Hay % leads enriquecidos pero 0 contactados', enriched_leads;
        RAISE NOTICE '   Posible causa: El proceso de contacto no se ha ejecutado aún';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE 'Ejecuta la query siguiente para ver el detalle por status:';
    
END $$;

-- Query manual para ver el detalle de status
SELECT 
    status,
    COUNT(*) as count,
    COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email
FROM leads
WHERE mission_id = (SELECT id FROM antonia_missions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1)
GROUP BY status
ORDER BY count DESC;
