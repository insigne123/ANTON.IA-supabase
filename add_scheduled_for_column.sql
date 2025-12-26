-- Add scheduled_for column to antonia_tasks to support timezone-aware scheduling
ALTER TABLE antonia_tasks 
ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ DEFAULT NULL;

-- Create an index to efficiently find ready tasks
-- Fix: Removed NOW() from predicate as it's not immutable. 
-- Indexing status and scheduled_for allows efficient filtering at query time.
CREATE INDEX IF NOT EXISTS idx_antonia_tasks_pending_scheduled 
ON antonia_tasks(scheduled_for) 
WHERE status = 'pending';
