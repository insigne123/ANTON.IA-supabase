-- Migration: Add RLS Policies for ANTON.IA Tables
-- This ensures users can only access their organization's data

-- Enable RLS on antonia tables if not already enabled
ALTER TABLE antonia_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE antonia_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE antonia_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE antonia_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE antonia_config ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their org missions" ON antonia_missions;
DROP POLICY IF EXISTS "Users can insert their org missions" ON antonia_missions;
DROP POLICY IF EXISTS "Users can update their org missions" ON antonia_missions;
DROP POLICY IF EXISTS "Users can delete their org missions" ON antonia_missions;

DROP POLICY IF EXISTS "Users can view their org tasks" ON antonia_tasks;
DROP POLICY IF EXISTS "Users can view their org daily usage" ON antonia_daily_usage;
DROP POLICY IF EXISTS "Users can view their org logs" ON antonia_logs;
DROP POLICY IF EXISTS "Users can view their org config" ON antonia_config;
DROP POLICY IF EXISTS "Users can update their org config" ON antonia_config;

-- =====================================================
-- ANTONIA_MISSIONS POLICIES
-- =====================================================

CREATE POLICY "Users can view their org missions"
ON antonia_missions FOR SELECT
USING (
    organization_id IN (
        SELECT organization_id 
        FROM organization_members 
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can insert their org missions"
ON antonia_missions FOR INSERT
WITH CHECK (
    organization_id IN (
        SELECT organization_id 
        FROM organization_members 
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can update their org missions"
ON antonia_missions FOR UPDATE
USING (
    organization_id IN (
        SELECT organization_id 
        FROM organization_members 
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can delete their org missions"
ON antonia_missions FOR DELETE
USING (
    organization_id IN (
        SELECT organization_id 
        FROM organization_members 
        WHERE user_id = auth.uid()
    )
);

-- =====================================================
-- ANTONIA_TASKS POLICIES
-- =====================================================

CREATE POLICY "Users can view their org tasks"
ON antonia_tasks FOR SELECT
USING (
    organization_id IN (
        SELECT organization_id 
        FROM organization_members 
        WHERE user_id = auth.uid()
    )
);

-- Note: Tasks are created by Cloud Functions (service role), not users
-- So we don't need INSERT/UPDATE/DELETE policies for regular users

-- =====================================================
-- ANTONIA_DAILY_USAGE POLICIES
-- =====================================================

CREATE POLICY "Users can view their org daily usage"
ON antonia_daily_usage FOR SELECT
USING (
    organization_id IN (
        SELECT organization_id 
        FROM organization_members 
        WHERE user_id = auth.uid()
    )
);

-- Note: Usage is updated by Cloud Functions (service role)

-- =====================================================
-- ANTONIA_LOGS POLICIES
-- =====================================================

CREATE POLICY "Users can view their org logs"
ON antonia_logs FOR SELECT
USING (
    organization_id IN (
        SELECT organization_id 
        FROM organization_members 
        WHERE user_id = auth.uid()
    )
);

-- =====================================================
-- ANTONIA_CONFIG POLICIES
-- =====================================================

CREATE POLICY "Users can view their org config"
ON antonia_config FOR SELECT
USING (
    organization_id IN (
        SELECT organization_id 
        FROM organization_members 
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can update their org config"
ON antonia_config FOR UPDATE
USING (
    organization_id IN (
        SELECT organization_id 
        FROM organization_members 
        WHERE user_id = auth.uid()
    )
);

-- Verify policies were created
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename IN ('antonia_missions', 'antonia_tasks', 'antonia_daily_usage', 'antonia_logs', 'antonia_config')
ORDER BY tablename, policyname;
