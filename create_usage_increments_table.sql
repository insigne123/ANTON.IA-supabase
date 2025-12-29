-- Create table to track usage increments and prevent duplicates
CREATE TABLE IF NOT EXISTS antonia_usage_increments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES antonia_tasks(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    increment_type TEXT NOT NULL, -- 'search', 'search_run', 'enrich', 'investigate', 'contact'
    amount INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate increments for the same task and type
    UNIQUE(task_id, increment_type)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_usage_increments_task_type 
ON antonia_usage_increments(task_id, increment_type);

-- Add RLS policies
ALTER TABLE antonia_usage_increments ENABLE ROW LEVEL SECURITY;

-- Users can view their org's increment logs
CREATE POLICY "Users can view their org increment logs"
ON antonia_usage_increments
FOR SELECT
USING (
    organization_id IN (
        SELECT organization_id 
        FROM organization_members 
        WHERE user_id = auth.uid()
    )
);

-- Service role can manage all increments
CREATE POLICY "Service role can manage increments"
ON antonia_usage_increments
FOR ALL
TO service_role
USING (true);
