-- Query to verify if CONTACT tasks are being scheduled correctly
-- It shows the Lead Location, UTC Schedule, and estimated Local Time

SELECT 
    t.id,
    t.status,
    t.created_at,
    t.scheduled_for,
    -- Extract location from payload to verify logic
    t.payload->'leads'->0->>'company_location' as location,
    t.payload->'leads'->0->>'email' as lead_email,
    -- Calculate difference in hours between creation and schedule
    EXTRACT(EPOCH FROM (t.scheduled_for - t.created_at))/3600 as hours_delay
FROM antonia_tasks t
WHERE t.type = 'CONTACT'
  AND t.status = 'pending'
ORDER BY t.created_at DESC
LIMIT 10;
