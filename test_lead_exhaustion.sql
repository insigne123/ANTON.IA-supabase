-- Test Script: Lead Exhaustion Detection and Reuse
-- This script simulates a scenario where a SEARCH task returns 0 leads
-- and verifies that the system correctly reuses previously found leads

-- SCENARIO 1: Test with uncontacted enriched leads available
-- This should create an INVESTIGATE task to reuse the leads

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

    RAISE NOTICE 'Test Org: %, User: %, Mission: %', test_org_id, test_user_id, test_mission_id;

    -- 2. Ensure there are some enriched leads that haven't been contacted
    -- (You may need to manually create some test leads first)
    
    -- Check current state
    RAISE NOTICE '=== Current State ===';
    RAISE NOTICE 'Total leads for mission: %', (SELECT COUNT(*) FROM leads WHERE mission_id = test_mission_id);
    RAISE NOTICE 'Enriched leads: %', (SELECT COUNT(*) FROM leads WHERE mission_id = test_mission_id AND status = 'enriched');
    RAISE NOTICE 'Contacted leads: %', (SELECT COUNT(*) FROM contacted_leads WHERE mission_id = test_mission_id);
    
    -- 3. Create a SEARCH task that will simulate finding 0 leads
    -- Note: This will actually call the external API, so it might find real leads
    -- For true testing, you'd need to mock the API or use a filter that returns 0 results
    
    INSERT INTO antonia_tasks (
        mission_id,
        organization_id,
        type,
        status,
        payload,
        created_at
    ) VALUES (
        test_mission_id,
        test_org_id,
        'SEARCH',
        'pending',
        jsonb_build_object(
            'jobTitle', 'Extremely Rare Job Title That Does Not Exist XYZ123',
            'location', 'Nonexistent City',
            'industry', 'Nonexistent Industry',
            'keywords', 'impossible-to-find-keyword-xyz'
        ),
        NOW()
    );
    
    RAISE NOTICE '✅ Created SEARCH task with filters that should return 0 results';
    RAISE NOTICE 'Wait for the Cloud Function to process this task (~1 minute)';
    RAISE NOTICE 'Then check:';
    RAISE NOTICE '  1. antonia_logs for "No se encontraron nuevos leads" warning';
    RAISE NOTICE '  2. antonia_logs for "Reutilizando X leads" info (if uncontacted leads exist)';
    RAISE NOTICE '  3. antonia_tasks for new INVESTIGATE task (if uncontacted leads exist)';
    RAISE NOTICE '  4. antonia_tasks for new GENERATE_REPORT task with reportType=lead_exhaustion_alert (if NO uncontacted leads)';
    
END $$;
