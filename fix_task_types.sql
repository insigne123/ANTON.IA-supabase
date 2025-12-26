-- Fix check constraint on antonia_tasks to allow GENERATE_REPORT
ALTER TABLE antonia_tasks DROP CONSTRAINT IF EXISTS antonia_tasks_type_check;

ALTER TABLE antonia_tasks 
ADD CONSTRAINT antonia_tasks_type_check 
CHECK (type IN ('SEARCH', 'ENRICH', 'CONTACT', 'REPORT', 'ALERT', 'GENERATE_REPORT', 'CONTACT_CAMPAIGN', 'CONTACT_INITIAL', 'EVALUATE', 'INVESTIGATE', 'GENERATE_CAMPAIGN'));
