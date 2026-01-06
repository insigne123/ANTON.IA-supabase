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
            m.user_id,
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
                        'userId', mission_record.user_id,
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

    -- ==================================================================================
    -- 2. GLOBAL REPORTS SCHEDULING (Per Organization)
    -- ==================================================================================
    DECLARE
        org_record RECORD;
        report_count integer;
    BEGIN
        FOR org_record IN 
             SELECT 
                c.organization_id, 
                c.daily_report_enabled,
                c.notification_email,
                -- We need a user_id to assign the task to. We can pick the owner or any member.
                -- For simplicity, let's pick the first admin-like user found or the one who set up config.
                -- Ideally antonia_config should have a 'user_id' or 'created_by'. 
                -- If not, we query members.
                (SELECT user_id FROM organization_members om WHERE om.organization_id = c.organization_id LIMIT 1) as admin_user_id
             FROM antonia_config c
             WHERE c.daily_report_enabled = true
        LOOP
             -- DAILY REPORT
             IF NOT EXISTS (
                SELECT 1 FROM antonia_tasks t 
                WHERE t.organization_id = org_record.organization_id 
                AND t.type = 'GENERATE_REPORT'
                AND t.payload->>'reportType' = 'daily'
                AND DATE(t.created_at) = today_date
             ) THEN
                INSERT INTO antonia_tasks (
                    organization_id,
                    type,
                    status,
                    payload,
                    idempotency_key,
                    created_at
                ) VALUES (
                    org_record.organization_id,
                    'GENERATE_REPORT',
                    'pending',
                    jsonb_build_object(
                         'reportType', 'daily',
                         'userId', org_record.admin_user_id,
                         'date', today_date
                    ),
                    'daily_report_' || org_record.organization_id || '_' || today_date,
                    NOW()
                );
                RAISE NOTICE 'Org %: Scheduled DAILY REPORT', org_record.organization_id;
             END IF;

             -- WEEKLY REPORT (Mondays)
             -- EXTRACT(DOW FROM current_date) returns 1 for Monday
             IF EXTRACT(DOW FROM today_date) = 1 THEN
                 IF NOT EXISTS (
                    SELECT 1 FROM antonia_tasks t 
                    WHERE t.organization_id = org_record.organization_id 
                    AND t.type = 'GENERATE_REPORT'
                    AND t.payload->>'reportType' = 'weekly'
                    AND DATE(t.created_at) = today_date
                 ) THEN
                    INSERT INTO antonia_tasks (
                        organization_id,
                        type,
                        status,
                        payload,
                        idempotency_key,
                        created_at
                    ) VALUES (
                        org_record.organization_id,
                        'GENERATE_REPORT',
                        'pending',
                        jsonb_build_object(
                             'reportType', 'weekly',
                             'userId', org_record.admin_user_id,
                             'weekStart', today_date - 7,
                             'weekEnd', today_date
                        ),
                        'weekly_report_' || org_record.organization_id || '_' || today_date,
                        NOW()
                    );
                    RAISE NOTICE 'Org %: Scheduled WEEKLY REPORT', org_record.organization_id;
                 END IF;
             END IF;
        END LOOP;
    END;
    
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION schedule_daily_mission_tasks() TO authenticated;
