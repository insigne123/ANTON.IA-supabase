SELECT 
    id,
    type,
    status,
    created_at,
    (payload::jsonb)->>'campaignName' as campaign_name,
    (payload::jsonb)->>'userId' as user_id_in_payload
FROM antonia_tasks
WHERE mission_id = (
    SELECT id FROM antonia_missions 
    WHERE title LIKE '%Prueba 35%' 
    ORDER BY created_at DESC 
    LIMIT 1
)
ORDER BY created_at ASC;
