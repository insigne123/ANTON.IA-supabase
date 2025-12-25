-- Fix antonia_daily_usage table to include search_runs column
-- This column tracks how many times the search task has been executed (not just leads found)

-- Add the missing column
ALTER TABLE antonia_daily_usage 
ADD COLUMN IF NOT EXISTS search_runs int DEFAULT 0;

-- Update existing rows to have a default value
UPDATE antonia_daily_usage 
SET search_runs = 0 
WHERE search_runs IS NULL;

-- Ensure RLS policies allow service role to insert/update
-- (The Cloud Functions use service role to update usage)
DROP POLICY IF EXISTS "Service role can manage usage" ON antonia_daily_usage;

CREATE POLICY "Service role can manage usage" 
ON antonia_daily_usage 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- Verify the fix
SELECT 
    column_name, 
    data_type, 
    column_default 
FROM information_schema.columns 
WHERE table_name = 'antonia_daily_usage' 
ORDER BY ordinal_position;
