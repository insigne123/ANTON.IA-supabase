-- Update scheduler to use Lead Queue
-- This function decides whether to SEARCH (new leads) or ENRICH (process queue)

CREATE OR REPLACE FUNCTION schedule_daily_mission_tasks()
RETURNS TABLE(mission_id uuid, tasks_created integer) AS $$
DECLARE
    mission_record RECORD;
    task_count integer;
    today_date date;
    result_mission_id uuid;
    result_tasks_created integer;
    queue_count integer;
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
        
        -- Check if we already created a task (SEARCH or ENRICH) today for this mission
        -- We only want one "driver" task per day per mission
        IF NOT EXISTS (
            SELECT 1 FROM antonia_tasks t
            WHERE t.mission_id = mission_record.id
            AND (t.type = 'SEARCH' OR t.type = 'ENRICH')
            AND DATE(t.created_at) = today_date
        ) THEN
            
            -- CHECK QUEUE: Count saved leads for this mission that haven't been processed
            SELECT COUNT(*) INTO queue_count
            FROM leads
            WHERE leads.mission_id = mission_record.id
            AND leads.status = 'saved';

            IF queue_count > 0 THEN
                -- PRIORITY: Process Queue (ENRICH)
                -- We create an ENRICH task. The worker will pick up leads from DB.
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
                    'ENRICH',
                    'pending',
                    jsonb_build_object(
                        'userId', mission_record.params->>'userId', -- Extract from params
                        'source', 'queue',
                        'queueCount', queue_count,
                        'enrichmentLevel', mission_record.params->>'enrichmentLevel',
                        'campaignName', mission_record.params->>'campaignName'
                    ),
                    'daily_enrich_queue_' || mission_record.id || '_' || today_date,
                    NOW()
                );
                
                RAISE NOTICE 'Mission %: Scheduled ENRICH task (Queue: %)', mission_record.title, queue_count;
                task_count := task_count + 1;
            
            ELSE
                -- DEFAULT: SEARCH for new leads
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
                
                RAISE NOTICE 'Mission %: Scheduled SEARCH task', mission_record.title;
                task_count := task_count + 1;
            END IF;
            
        END IF;
        
        -- Return results
        result_mission_id := mission_record.id;
        result_tasks_created := task_count;
        mission_id := result_mission_id;
        tasks_created := result_tasks_created;
        RETURN NEXT;
    END LOOP;
    
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION schedule_daily_mission_tasks() TO authenticated;
