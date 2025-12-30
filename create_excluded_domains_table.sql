-- Create excluded_domains table
CREATE TABLE IF NOT EXISTS excluded_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL, -- Logical separation by org, though mostly used by system
    domain TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_excluded_domains_org_domain ON excluded_domains(organization_id, domain);

-- RLS Policies
ALTER TABLE excluded_domains ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view excluded domains for their organization
CREATE POLICY "Users can view excluded domains for their org"
ON excluded_domains FOR SELECT
USING (
    organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
);

-- Policy: Users can insert excluded domains for their organization
CREATE POLICY "Users can insert excluded domains for their org"
ON excluded_domains FOR INSERT
WITH CHECK (
    organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
);

-- Policy: Users can delete excluded domains for their organization
CREATE POLICY "Users can delete excluded domains for their org"
ON excluded_domains FOR DELETE
USING (
    organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
);
