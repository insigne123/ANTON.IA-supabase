-- Fix Leads Visibility
-- 1. Backfill organization_id for leads that are missing it
-- We assume the lead belongs to the first organization of the user who created it.

UPDATE leads l
SET organization_id = (
    SELECT organization_id 
    FROM organization_members om 
    WHERE om.user_id = l.user_id 
    LIMIT 1
)
WHERE l.organization_id IS NULL;

-- 2. Update RLS Policy for Leads to be Organization-based
DROP POLICY IF EXISTS "Users can view their own leads" ON leads;
DROP POLICY IF EXISTS "Users can insert their own leads" ON leads;
DROP POLICY IF EXISTS "Users can update their own leads" ON leads;
DROP POLICY IF EXISTS "Users can delete their own leads" ON leads;

-- View: Members can view leads of their organization
CREATE POLICY "Members can view org leads"
  ON leads FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- Insert: Users can insert leads for their organization
CREATE POLICY "Users can insert org leads"
  ON leads FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- Update: Members can update leads of their organization
CREATE POLICY "Members can update org leads"
  ON leads FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- Delete: Members can delete leads of their organization
CREATE POLICY "Members can delete org leads"
  ON leads FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
