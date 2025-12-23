-- 1. Fix Task Type Constraint
ALTER TABLE antonia_tasks DROP CONSTRAINT IF EXISTS antonia_tasks_type_check;
ALTER TABLE antonia_tasks ADD CONSTRAINT antonia_tasks_type_check 
  CHECK (type IN ('SEARCH', 'ENRICH', 'CONTACT', 'REPORT', 'ALERT', 'GENERATE_CAMPAIGN'));

-- 2. Ensure Cascade Delete is set correctly (Already in schema, but good to verify if recreating)
-- diagnostic_antonia.sql defined: mission_id uuid references antonia_missions(id) on delete cascade
-- This means deleting a mission will automatically delete all its tasks and logs.

-- 3. Verify Constraints
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'antonia_tasks'::regclass 
AND conname = 'antonia_tasks_type_check';
