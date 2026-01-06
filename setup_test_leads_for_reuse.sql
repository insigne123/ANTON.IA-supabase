-- Setup Script: Create Test Enriched Leads for Reuse Testing
-- This creates some enriched leads that haven't been contacted yet
-- so we can test the lead reuse functionality

DO $$
DECLARE
    test_org_id uuid;
    test_user_id uuid;
    test_mission_id uuid;
BEGIN
    -- 1. Get existing organization, user, and mission
    SELECT id INTO test_org_id FROM organizations LIMIT 1;
    SELECT user_id INTO test_user_id FROM organization_members WHERE organization_id = test_org_id LIMIT 1;
    SELECT id INTO test_mission_id FROM antonia_missions WHERE organization_id = test_org_id AND status = 'active' LIMIT 1;

    RAISE NOTICE 'Creating test enriched leads for Mission: %', test_mission_id;

    -- 2. Create 3 test enriched leads
    INSERT INTO leads (
        user_id,
        organization_id,
        mission_id,
        name,
        title,
        company,
        email,
        linkedin_url,
        status,
        created_at
    ) VALUES 
    (
        test_user_id,
        test_org_id,
        test_mission_id,
        'Test Lead 1 - Reuse',
        'Test Manager',
        'Test Company A',
        'test.lead1@example.com',
        'https://linkedin.com/in/test1',
        'enriched',
        NOW()
    ),
    (
        test_user_id,
        test_org_id,
        test_mission_id,
        'Test Lead 2 - Reuse',
        'Test Director',
        'Test Company B',
        'test.lead2@example.com',
        'https://linkedin.com/in/test2',
        'enriched',
        NOW()
    ),
    (
        test_user_id,
        test_org_id,
        test_mission_id,
        'Test Lead 3 - Reuse',
        'Test VP',
        'Test Company C',
        'test.lead3@example.com',
        'https://linkedin.com/in/test3',
        'enriched',
        NOW()
    );

    RAISE NOTICE '✅ Created 3 test enriched leads';
    RAISE NOTICE 'These leads are marked as "enriched" but have NOT been contacted yet';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Run test_lead_exhaustion.sql to trigger a search that returns 0 results';
    RAISE NOTICE '2. Wait ~1 minute for Cloud Function to process';
    RAISE NOTICE '3. Run verify_lead_exhaustion.sql to check results';
    RAISE NOTICE '4. Verify that an INVESTIGATE task was created to reuse these leads';
    
END $$;
