-- Verification Script: Check Lead Exhaustion Detection Results
-- Run this AFTER the test_lead_exhaustion.sql task has been processed

DO $$
DECLARE
    test_mission_id uuid;
    log_count integer;
    investigate_count integer;
    report_count integer;
BEGIN
    -- Get the test mission
    SELECT id INTO test_mission_id FROM antonia_missions WHERE status = 'active' LIMIT 1;
    
    RAISE NOTICE '=== Verification Results for Mission: % ===', test_mission_id;
    RAISE NOTICE '';
    
    -- 1. Check for exhaustion warning log
    SELECT COUNT(*) INTO log_count 
    FROM antonia_logs 
    WHERE mission_id = test_mission_id 
    AND message LIKE '%No se encontraron nuevos leads%'
    AND created_at > NOW() - INTERVAL '10 minutes';
    
    RAISE NOTICE '1. Exhaustion Warning Logs (last 10 min): %', log_count;
    
    IF log_count > 0 THEN
        RAISE NOTICE '   ✅ Exhaustion detected correctly';
    ELSE
        RAISE NOTICE '   ❌ No exhaustion warning found';
    END IF;
    RAISE NOTICE '';
    
    -- 2. Check for reuse info log
    SELECT COUNT(*) INTO log_count 
    FROM antonia_logs 
    WHERE mission_id = test_mission_id 
    AND message LIKE '%Reutilizando%leads%'
    AND created_at > NOW() - INTERVAL '10 minutes';
    
    RAISE NOTICE '2. Lead Reuse Logs (last 10 min): %', log_count;
    
    IF log_count > 0 THEN
        RAISE NOTICE '   ✅ System attempted to reuse previous leads';
        
        -- Show details
        RAISE NOTICE '   Details:';
        FOR log_count IN 
            SELECT details->>'uncontactedCount' as count
            FROM antonia_logs 
            WHERE mission_id = test_mission_id 
            AND message LIKE '%Reutilizando%leads%'
            AND created_at > NOW() - INTERVAL '10 minutes'
        LOOP
            RAISE NOTICE '     - Found % uncontacted leads to reuse', log_count;
        END LOOP;
    ELSE
        RAISE NOTICE '   ℹ️  No lead reuse attempted (may not have uncontacted leads)';
    END IF;
    RAISE NOTICE '';
    
    -- 3. Check for INVESTIGATE task creation
    SELECT COUNT(*) INTO investigate_count 
    FROM antonia_tasks 
    WHERE mission_id = test_mission_id 
    AND type = 'INVESTIGATE'
    AND payload->>'source' = 'reused_from_previous_searches'
    AND created_at > NOW() - INTERVAL '10 minutes';
    
    RAISE NOTICE '3. INVESTIGATE Tasks Created (last 10 min): %', investigate_count;
    
    IF investigate_count > 0 THEN
        RAISE NOTICE '   ✅ Reuse tasks created successfully';
    ELSE
        RAISE NOTICE '   ℹ️  No INVESTIGATE tasks (no uncontacted leads available)';
    END IF;
    RAISE NOTICE '';
    
    -- 4. Check for critical exhaustion log
    SELECT COUNT(*) INTO log_count 
    FROM antonia_logs 
    WHERE mission_id = test_mission_id 
    AND message LIKE '%AGOTAMIENTO TOTAL%'
    AND created_at > NOW() - INTERVAL '10 minutes';
    
    RAISE NOTICE '4. Critical Exhaustion Logs (last 10 min): %', log_count;
    
    IF log_count > 0 THEN
        RAISE NOTICE '   ⚠️  CRITICAL: No leads available at all';
    ELSE
        RAISE NOTICE '   ✅ Still have leads to work with';
    END IF;
    RAISE NOTICE '';
    
    -- 5. Check for exhaustion alert report task
    SELECT COUNT(*) INTO report_count 
    FROM antonia_tasks 
    WHERE mission_id = test_mission_id 
    AND type = 'GENERATE_REPORT'
    AND payload->>'reportType' = 'lead_exhaustion_alert'
    AND created_at > NOW() - INTERVAL '10 minutes';
    
    RAISE NOTICE '5. Exhaustion Alert Report Tasks (last 10 min): %', report_count;
    
    IF report_count > 0 THEN
        RAISE NOTICE '   ✅ Alert report task created';
        RAISE NOTICE '   Check your email for the exhaustion alert';
    ELSE
        RAISE NOTICE '   ℹ️  No alert report needed';
    END IF;
    RAISE NOTICE '';
    
    -- 6. Show recent logs for this mission
    RAISE NOTICE '=== Recent Logs (last 10 minutes) ===';
    FOR log_count IN 
        SELECT level, message, created_at 
        FROM antonia_logs 
        WHERE mission_id = test_mission_id 
        AND created_at > NOW() - INTERVAL '10 minutes'
        ORDER BY created_at DESC
        LIMIT 10
    LOOP
        -- This is just to trigger the loop, actual output is in the SELECT
    END LOOP;
    
    -- Show the logs
    RAISE NOTICE 'Check antonia_logs table for detailed information';
    
END $$;

-- Display recent logs
SELECT 
    created_at,
    level,
    message,
    details
FROM antonia_logs 
WHERE created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC
LIMIT 20;
