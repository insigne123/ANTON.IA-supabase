-- FIX RLS Policies for Quota Usage

-- 1. Permits for antonia_daily_usage
ALTER TABLE antonia_daily_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view usage for their organization" ON antonia_daily_usage;
DROP POLICY IF EXISTS "Users can update usage for their organization" ON antonia_daily_usage;
DROP POLICY IF EXISTS "Users can insert usage for their organization" ON antonia_daily_usage;

-- Allow SELECT
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

-- Allow INSERT (needed for Cloud Functions / Server side if using service role, but good to have)
-- Note: Usually only backend updates usage, but if client fetches, it needs select.

-- 2. Permits for contacted_leads (Used for counting daily contacts)
ALTER TABLE contacted_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their organization contacted leads" ON contacted_leads;

CREATE POLICY "Users can view their organization contacted leads" ON contacted_leads
    FOR SELECT
    TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id 
            FROM organization_members 
            WHERE user_id = auth.uid()
        )
    );

-- 3. Validation: Check if you have an organization member
-- If this returns empty, you are not in an organization
SELECT * FROM organization_members WHERE user_id = auth.uid();
