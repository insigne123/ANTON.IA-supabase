-- Verification Script: Lead Queueing System
-- Purpose: Verify that leads are being saved with mission_id and queue logic works

-- 1. Check if mission_id column exists in leads table
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'leads' 
AND column_name = 'mission_id';

-- 2. Check if index was created
SELECT 
    indexname, 
    indexdef
FROM pg_indexes 
WHERE tablename = 'leads' 
AND indexname = 'leads_mission_id_status_idx';

-- 3. Count leads by mission_id and status
SELECT 
    m.title as mission_title,
    l.mission_id,
    l.status,
    COUNT(*) as lead_count
FROM leads l
LEFT JOIN antonia_missions m ON l.mission_id = m.id
GROUP BY m.title, l.mission_id, l.status
ORDER BY l.mission_id, l.status;

-- 4. Check recent leads with mission_id
SELECT 
    l.id,
    l.name,
    l.company,
    l.status,
    l.mission_id,
    m.title as mission_title,
    l.created_at
FROM leads l
LEFT JOIN antonia_missions m ON l.mission_id = m.id
WHERE l.created_at > NOW() - INTERVAL '7 days'
ORDER BY l.created_at DESC
LIMIT 20;

-- 5. Check active missions and their pending leads
SELECT 
    m.id as mission_id,
    m.title,
    m.status as mission_status,
    COUNT(l.id) FILTER (WHERE l.status = 'saved') as saved_leads,
    COUNT(l.id) FILTER (WHERE l.status = 'enriched') as enriched_leads,
    COUNT(l.id) as total_leads
FROM antonia_missions m
LEFT JOIN leads l ON l.mission_id = m.id
WHERE m.status = 'active'
GROUP BY m.id, m.title, m.status
ORDER BY m.created_at DESC;

-- 6. Check recent ENRICH tasks from queue
SELECT 
    t.id,
    t.mission_id,
    m.title as mission_title,
    t.type,
    t.status,
    t.payload->>'source' as source,
    t.payload->>'queueCount' as queue_count,
    t.created_at
FROM antonia_tasks t
LEFT JOIN antonia_missions m ON t.mission_id = m.id
WHERE t.type = 'ENRICH'
AND t.created_at > NOW() - INTERVAL '7 days'
ORDER BY t.created_at DESC
LIMIT 10;

-- 7. Check if scheduler function exists and is updated
SELECT 
    proname as function_name,
    pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE proname = 'schedule_daily_mission_tasks';

-- 8. Leads without mission_id (should be old leads or manually created)
SELECT 
    COUNT(*) as leads_without_mission,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as recent_without_mission
FROM leads
WHERE mission_id IS NULL;
