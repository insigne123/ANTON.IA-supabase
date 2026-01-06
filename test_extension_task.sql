-- Create a test task for the extension to pick up
-- REPLACE 'YOUR_LINKEDIN_PROFILE_URL' with a URL you want to test sending a message TO (e.g., a friend or second account)
-- Ensure 'provider' is 'linkedin' and 'status' is 'scheduled'

INSERT INTO contacted_leads (
    user_id, -- Assuming a valid user_id exists, or use a placeholder if RLS allows
    linkedin_url,
    linkedin_thread_url, -- Extension uses this url to navigate
    first_name,
    last_name,
    company_name,
    status,
    provider,
    scheduled_at,
    subject -- This will be the message content
) VALUES (
    '550e8400-e29b-41d4-a716-446655440000', -- You might need to change this to your actual user ID in Supabase
    'https://www.linkedin.com/in/williamhgates', -- Dummy profile
    'https://www.linkedin.com/in/williamhgates', -- Profile to visit
    'Bill',
    'Gates',
    'Microsoft',
    'scheduled',
    'linkedin',
    NOW(), -- Due now
    'Hola! Esto es una prueba de automatización de Anton.IA. Por favor ignora este mensaje.'
);
