-- test_random_lead_dry_run.sql
-- 1. Finds ANY random lead that has Email and Company Name (to ensure success).
-- 2. Uses your valid User ID (Nicolas Yarur).
-- 3. Triggers the full flow (Enrich -> Investigate -> Contact) in DRY RUN mode.

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
    WHERE l.email IS NOT NULL 
      AND l.company IS NOT NULL 
      AND l.company != ''
      -- We explicitly select your user to ensure the "Company Profile" is valid
      AND p.id = 'de3a3194-29b1-449a-828a-53608a7ebe47' 
    ORDER BY random() -- Pick a random one
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
    'ENRICH',
    'pending',
    jsonb_build_object(
        'userId', user_id,
        'dryRun', true, -- 🔴 DRY RUN ENABLED
        'campaignName', 'Random Lead Dry Run Test',
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
