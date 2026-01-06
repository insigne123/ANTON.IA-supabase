-- SCRIPT TO TEST REPORT GENERATION
-- 1. This creates a task that triggers the Cloud Function's Generate Report logic immediately.

DO $$
DECLARE
    my_org_id uuid;
    my_user_id uuid;
BEGIN
    -- 1. Get an existing Organization
    SELECT id INTO my_org_id FROM organizations LIMIT 1;
    
    -- 2. Get a user (ideally the one compliant with previous tests)
    -- Using the specific user ID from previous contexts or fetching valid one
    SELECT user_id INTO my_user_id FROM antonia_missions WHERE organization_id = my_org_id LIMIT 1;

    -- 3. Insert GENERATE_REPORT task (Daily)
    INSERT INTO antonia_tasks (
        organization_id,
        type, 
        status, 
        payload, 
        created_at
    )
    VALUES (
        my_org_id,
        'GENERATE_REPORT',
        'pending',
        jsonb_build_object(
            'reportType', 'daily',
            'userId', my_user_id,
            'date', CURRENT_DATE
        ),
        NOW()
    );
    
    RAISE NOTICE 'Created test DAILY REPORT task for Org % User %', my_org_id, my_user_id;

END $$;
