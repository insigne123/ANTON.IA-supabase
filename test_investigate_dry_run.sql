-- test_investigate_dry_run.sql
-- Create a manual INVESTIGATE task that will call N8N but then trigger a DRY RUN contact.

WITH target_lead AS (
    SELECT id, mission_id, organization_id, email, full_name, company_name, title, linkedin_url
    FROM leads
    WHERE email IS NOT NULL
    ORDER BY created_at DESC
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
    'INVESTIGATE', -- Simulating the step BEFORE contact
    'pending',
    jsonb_build_object(
        'userId', 'de3a3194-29b1-449a-828a-53608a7ebe47', -- Tu ID
        'dryRun', true, -- 🔴 ACTIVAR MODO DRY RUN (Se pasará al CONTACT task)
        'campaignName', 'Investigate Re-run Test',
        'leads', jsonb_build_array(
            jsonb_build_object(
                'id', id,
                'email', email,
                'fullName', full_name,
                'companyName', company_name,
                'title', title,
                'linkedinUrl', linkedin_url,
                -- Mocking the new fields expected from Enrichment
                'industry', 'Software',
                'location', 'Santiago, Chile',
                'companyDomain', 'example.com',
                'website', 'https://example.com'
            )
        )
    ),
    NOW()
FROM target_lead;
