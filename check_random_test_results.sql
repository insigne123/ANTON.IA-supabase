-- check_random_test_results.sql
-- Check results specifically for the Random Lead test
SELECT 
    created_at,
    type as TAREA,
    status as ESTADO,
    payload->'leads'->0->'email' as LEAD_EMAIL,
    payload->>'dryRun' as DRY_RUN,
    CASE 
        WHEN type = 'CONTACT' THEN payload->'leads'->0->'research'->'emailDraft'->>'subject' 
        ELSE NULL 
    END AS ASUNTO_GENERADO,
    CASE 
        WHEN type = 'CONTACT' THEN payload->'leads'->0->'research'->'emailDraft'->>'body' 
        ELSE NULL 
    END AS CUERPO_MAIL
FROM antonia_tasks 
WHERE payload->>'campaignName' = 'Random Lead Dry Run Test'
ORDER BY created_at ASC;
