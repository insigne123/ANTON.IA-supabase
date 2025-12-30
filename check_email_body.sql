-- check_email_body.sql
-- The 'body' is not stored in contacted_leads, but it IS stored in the task payload
-- coming from the Investigation step.

SELECT 
    created_at,
    type,
    payload->'leads'->0->'email' as lead_email,
    payload->'leads'->0->'research'->'emailDraft'->>'subject' as draft_subject,
    payload->'leads'->0->'research'->'emailDraft'->>'body' as draft_body
FROM antonia_tasks 
WHERE type = 'CONTACT'
ORDER BY created_at DESC 
LIMIT 1;
