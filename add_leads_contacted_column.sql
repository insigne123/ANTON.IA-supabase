-- Migration: Add leads_contacted column to antonia_daily_usage
-- This column tracks the number of leads contacted per day per organization

-- Add the column if it doesn't exist
ALTER TABLE antonia_daily_usage 
ADD COLUMN IF NOT EXISTS leads_contacted INTEGER DEFAULT 0;

-- Update existing rows to have 0 as default
UPDATE antonia_daily_usage 
SET leads_contacted = 0 
WHERE leads_contacted IS NULL;

-- Verify the change
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'antonia_daily_usage'
ORDER BY ordinal_position;
