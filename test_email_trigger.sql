-- SCRIPT TO TRIGGER A TEST EMAIL
-- 1. Replace 'TU_EMAIL_AQUI' with your email address
-- 2. Run this script in Supabase SQL Editor
-- 3. Wait for the Cron to run (max 5 minutes) or trigger it manually

DO $$
DECLARE
    target_email text := 'TU_EMAIL_AQUI'; -- <<< CAMBIA ESTO
    
    -- Variables to fetch existing context
    my_org_id uuid;
    my_user_id uuid;
    mission_id uuid;
    lead_json jsonb;
BEGIN
    -- 1. Get an existing Organization and User (picking the first active one found)
    SELECT id INTO my_org_id FROM organizations LIMIT 1;
    SELECT id INTO my_user_id FROM auth.users LIMIT 1;

    -- 2. Create a temporary Test Mission
    INSERT INTO antonia_missions (organization_id, user_id, title, status, goal_summary)
    VALUES (my_org_id, my_user_id, 'Misión de Prueba de Email', 'completed', 'Verificación de formato de correo')
    RETURNING id INTO mission_id;

    -- 3. Prepare the Lead Data with Research Summary
    lead_json := jsonb_build_object(
        'email', target_email,
        'full_name', 'Usuario de Prueba',
        'company_name', 'Tu Empresa S.A.',
        'title', 'Evaluador de Calidad',
        'company_location', 'Chile', -- Will trigger immediate send (if during day) or next day
        'research', jsonb_build_object(
            'summary', 'están buscando mejorar sus procesos de automatización de ventas.'
        )
    );

    -- 4. Insert the CONTACT Task
    -- scheduled_for is set to NOW() to force immediate execution (bypassing timezone logic for this test)
    INSERT INTO antonia_tasks (
        mission_id, 
        organization_id, 
        type, 
        status, 
        payload, 
        scheduled_for,
        created_at
    )
    VALUES (
        mission_id,
        my_org_id,
        'CONTACT',
        'pending',
        jsonb_build_object(
            'userId', my_user_id,
            'campaignName', 'Campaña de Prueba',
            'leads', jsonb_build_array(lead_json)
        ),
        NOW(), -- Force Immediate Execution
        NOW()
    );
    
    RAISE NOTICE 'Test task created for email: %', target_email;
END $$;
