-- test_dry_run_contact.sql
-- Create a manual CONTACT task with dryRun: true

WITH target_lead AS (
    SELECT id, mission_id, organization_id, email, full_name, company_name
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
    'CONTACT',
    'pending',
    jsonb_build_object(
        'userId', 'de3a3194-29b1-449a-828a-53608a7ebe47', -- Tu ID
        'dryRun', true, -- 🔴 ACTIVAR MODO DRY RUN
        'campaignName', 'Dry Run Test',
        'leads', jsonb_build_array(
            jsonb_build_object(
                'id', id,
                'email', email,
                'fullName', full_name,
                'companyName', company_name,
                'research', jsonb_build_object(
                    'summary', 'es una empresa líder en su sector.',
                    'emailDraft', jsonb_build_object(
                        'subject', 'Prueba de Dry Run',
                        'body', 'Hola {{name}}, esto es solo una prueba que no debería enviarse.'
                    )
                )
            )
        )
    ),
    NOW()
FROM target_lead;
