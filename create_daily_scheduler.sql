-- Create a function to schedule daily tasks for active missions
-- This should be called once per day by the cron

CREATE OR REPLACE FUNCTION schedule_daily_mission_tasks()
RETURNS TABLE(mission_id uuid, tasks_created integer) AS $$
DECLARE
    mission_record RECORD;
    task_count integer;
    today_date date;
BEGIN
    today_date := CURRENT_DATE;
    
    -- Loop through all active missions
    FOR mission_record IN 
        SELECT 
            m.id,
            m.organization_id,
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
        
        -- Check if we already created a SEARCH task today for this mission
        IF NOT EXISTS (
            SELECT 1 FROM antonia_tasks
            WHERE mission_id = mission_record.id
            AND type = 'SEARCH'
            AND DATE(created_at) = today_date
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
                mission_record.params,
                'daily_search_' || mission_record.id || '_' || today_date,
                NOW()
            );
            
            task_count := task_count + 1;
        END IF;
        
        -- Return the mission and number of tasks created
        mission_id := mission_record.id;
        tasks_created := task_count;
        RETURN NEXT;
    END LOOP;
    
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users (service role will call this)
GRANT EXECUTE ON FUNCTION schedule_daily_mission_tasks() TO authenticated;
