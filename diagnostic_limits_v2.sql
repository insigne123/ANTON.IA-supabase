-- Migration to add search_runs tracking
-- Run this in Supabase SQL Editor

ALTER TABLE antonia_daily_usage 
ADD COLUMN IF NOT EXISTS search_runs integer DEFAULT 0;

-- Optional: Reset existing runs to 0 if needed (default handles it for new rows)
-- UPDATE antonia_daily_usage SET search_runs = 0 WHERE search_runs IS NULL;
