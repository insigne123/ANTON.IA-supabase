-- test_full_flow_dry_run.sql
-- 1. Finds the specific lead requested (Felipe Ochoa Cornejo) and a valid user.
-- 2. Inserts an ENRICH task with dryRun: true.
-- This will trigger: ENRICH -> INVESTIGATE (dryRun) -> CONTACT (dryRun).

WITH target_data AS (
    SELECT 
        l.id as lead_id,
        l.email,
        l.name as full_name,
        l.company,
        l.title,
        l.linkedin_url,
        l.mission_id,
        l.organization_id,
        p.id as user_id
    FROM leads l, profiles p
    WHERE l.id = 'c41ae90f-c1e9-425b-9f53-1eca5953459d' -- The specific lead provided
    LIMIT 1
)
INSERT INTO antonia_tasks (
    mission_id,
    organization_id,
    type,
    status,
    payload,
    created_at
)
SELECT 
    mission_id,
    organization_id,
    'ENRICH', -- Start from Enrichment as requested
    'pending',
    jsonb_build_object(
        'userId', user_id, -- Uses a valid User ID from profiles
        'dryRun', true, -- 🔴 ACTIVAR MODO DRY RUN (Se propagará a Investigate y luego a Contact)
        'campaignName', 'Full Flow Dry Run Test',
        'enrichmentLevel', 'standard',
        'leads', jsonb_build_array(
            jsonb_build_object(
                'id', lead_id,
                'email', email,
                'name', full_name,
                'company_name', company,
                'title', title,
                'linkedin_url', linkedin_url
            )
        )
    ),
    NOW()
FROM target_data;
