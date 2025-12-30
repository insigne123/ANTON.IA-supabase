-- FIX: Schedule Daily Mission Tasks
-- 1. Adds 'GENERATE_CAMPAIGN' to the exclusion check to prevent race conditions with new missions.
-- 2. Explicitly injects 'userId' into the task payload (fixing the 'null' user id issue).

CREATE OR REPLACE FUNCTION schedule_daily_mission_tasks()
RETURNS TABLE(mission_id uuid, tasks_created integer) AS $$
DECLARE
    mission_record RECORD;
    task_count integer;
    today_date date;
    result_mission_id uuid;
    result_tasks_created integer;
BEGIN
    today_date := CURRENT_DATE;
    
    -- Loop through all active missions
    FOR mission_record IN 
        SELECT 
            m.id,
            m.organization_id,
            m.user_id, -- ADDED: Select user_id to include in payload
            m.title,
            m.params,
            m.daily_search_limit,
            m.daily_enrich_limit,
            m.daily_investigate_limit,
            m.daily_contact_limit
        FROM antonia_missions m
        WHERE m.status = 'active'
    LOOP
        task_count := 0;
        
        -- Check if we already created a SEARCH or GENERATE_CAMPAIGN task today
        -- This prevents creating a SEARCH task if the mission just started with a GENERATE task
        IF NOT EXISTS (
            SELECT 1 FROM antonia_tasks t
            WHERE t.mission_id = mission_record.id
            AND (t.type = 'SEARCH' OR t.type = 'GENERATE_CAMPAIGN') -- FIXED: Check both types
            AND DATE(t.created_at) = today_date
        ) THEN
            -- Create a new SEARCH task for today
            INSERT INTO antonia_tasks (
                mission_id,
                organization_id,
                type,
                status,
                payload,
                idempotency_key,
                created_at
            ) VALUES (
                mission_record.id,
                mission_record.organization_id,
                'SEARCH',
                'pending',
                -- FIXED: Merge params with userId safely
                COALESCE(mission_record.params::jsonb, '{}'::jsonb) || jsonb_build_object('userId', mission_record.user_id),
                'daily_search_' || mission_record.id || '_' || today_date,
                NOW()
            );
            
            task_count := task_count + 1;
        END IF;
        
        -- Return the mission and number of tasks created
        result_mission_id := mission_record.id;
        result_tasks_created := task_count;
        mission_id := result_mission_id;
        tasks_created := result_tasks_created;
        RETURN NEXT;
    END LOOP;
    
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions just in case
GRANT EXECUTE ON FUNCTION schedule_daily_mission_tasks() TO authenticated;
