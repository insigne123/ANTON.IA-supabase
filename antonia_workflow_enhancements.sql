-- ANTONIA Workflow Enhancements
-- Add per-mission daily limits and update task types

-- 1. Add per-mission limit columns
ALTER TABLE antonia_missions 
ADD COLUMN IF NOT EXISTS daily_search_limit integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS daily_enrich_limit integer DEFAULT 10,
ADD COLUMN IF NOT EXISTS daily_investigate_limit integer DEFAULT 5,
ADD COLUMN IF NOT EXISTS daily_contact_limit integer DEFAULT 3;

-- 2. Update task type constraint to include all workflow steps
ALTER TABLE antonia_tasks 
DROP CONSTRAINT IF EXISTS antonia_tasks_type_check;

ALTER TABLE antonia_tasks 
ADD CONSTRAINT antonia_tasks_type_check 
CHECK (type IN ('GENERATE_CAMPAIGN', 'SEARCH', 'ENRICH', 'INVESTIGATE', 'CONTACT', 'REPORT', 'ALERT'));

-- 3. Verify changes
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'antonia_missions' 
AND column_name LIKE 'daily_%';
