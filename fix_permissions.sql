-- Fix RLS for antonia_tasks to allow Report Generation
ALTER TABLE antonia_tasks ENABLE ROW LEVEL SECURITY;

-- Drop incorrect policies if they were partially created
DROP POLICY IF EXISTS "Users can insert their own tasks" ON antonia_tasks;
DROP POLICY IF EXISTS "Users can view their own tasks" ON antonia_tasks;
DROP POLICY IF EXISTS "Users can insert their organization tasks" ON antonia_tasks;
DROP POLICY IF EXISTS "Users can view their organization tasks" ON antonia_tasks;

CREATE POLICY "Users can insert their organization tasks" ON antonia_tasks
    FOR INSERT
    TO authenticated
    WITH CHECK (
        organization_id IN (
            SELECT organization_id 
            FROM organization_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can view their organization tasks" ON antonia_tasks
    FOR SELECT
    TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id 
            FROM organization_members 
            WHERE user_id = auth.uid()
        )
    );

-- Fix RLS for antonia_daily_usage to allow Quota checks
ALTER TABLE antonia_daily_usage ENABLE ROW LEVEL SECURITY;

-- If the table doesn't exist, create it (idempotent check)
CREATE TABLE IF NOT EXISTS antonia_daily_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    date DATE NOT NULL,
    leads_searched INTEGER DEFAULT 0,
    leads_enriched INTEGER DEFAULT 0,
    leads_investigated INTEGER DEFAULT 0,
    leads_contacted INTEGER DEFAULT 0,
    search_runs INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, date)
);

DROP POLICY IF EXISTS "Users can view usage for their organization" ON antonia_daily_usage;

-- Policy involves reading organization_members to verify access to org data
CREATE POLICY "Users can view usage for their organization" ON antonia_daily_usage
    FOR SELECT
    TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id 
            FROM organization_members 
            WHERE user_id = auth.uid()
        )
    );

-- Ensure indexes exist for performance matching the API queries
CREATE INDEX IF NOT EXISTS idx_daily_usage_org_date ON antonia_daily_usage(organization_id, date);
