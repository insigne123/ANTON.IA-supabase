-- check_task_userid.sql
-- Check the specific task or mission related to lead Vicente Cruz Infante or similar
WITH target_lead AS (
    SELECT id, mission_id, organization_id 
    FROM leads 
    WHERE email = 'vcruz@thesheriff.cl' 
    ORDER BY created_at DESC 
    LIMIT 1
)
SELECT 
    t.id as task_id,
    t.type,
    t.status,
    t.payload ->> 'userId' as payload_userid,
    m.user_id as mission_owner,
    m.id as mission_id
FROM antonia_tasks t
JOIN target_lead tl ON t.mission_id = tl.mission_id
JOIN antonia_missions m ON t.mission_id = m.id
WHERE t.type IN ('INVESTIGATE', 'ENRICH', 'SEARCH')
ORDER BY t.created_at DESC;
