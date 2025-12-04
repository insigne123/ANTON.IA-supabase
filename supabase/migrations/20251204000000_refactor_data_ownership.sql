-- Refactor Data Ownership to be User-Centric
-- Goal: Prevent data loss when Org is deleted, and allow Hybrid Access (User OR Org).

-- 1. Update Foreign Keys to ON DELETE SET NULL
-- This ensures that if an organization is deleted, the data remains (orphaned from org, but owned by user).

-- Leads
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_organization_id_fkey;
ALTER TABLE leads 
  ADD CONSTRAINT leads_organization_id_fkey 
  FOREIGN KEY (organization_id) 
  REFERENCES organizations(id) 
  ON DELETE SET NULL;

-- Enriched Leads
ALTER TABLE enriched_leads DROP CONSTRAINT IF EXISTS enriched_leads_organization_id_fkey;
ALTER TABLE enriched_leads 
  ADD CONSTRAINT enriched_leads_organization_id_fkey 
  FOREIGN KEY (organization_id) 
  REFERENCES organizations(id) 
  ON DELETE SET NULL;

-- Contacted Leads
ALTER TABLE contacted_leads DROP CONSTRAINT IF EXISTS contacted_leads_organization_id_fkey;
ALTER TABLE contacted_leads 
  ADD CONSTRAINT contacted_leads_organization_id_fkey 
  FOREIGN KEY (organization_id) 
  REFERENCES organizations(id) 
  ON DELETE SET NULL;

-- Campaigns
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_organization_id_fkey;
ALTER TABLE campaigns 
  ADD CONSTRAINT campaigns_organization_id_fkey 
  FOREIGN KEY (organization_id) 
  REFERENCES organizations(id) 
  ON DELETE SET NULL;


-- 2. Update RLS Policies for Hybrid Access
-- Pattern: Access allowed if (I own the record) OR (Record is shared with my Org)

-- Helper function to check org membership (cached by query plan usually)
-- We use the existing get_user_org_ids() or subquery.

-- LEADS
DROP POLICY IF EXISTS "Members can view org leads" ON leads;
DROP POLICY IF EXISTS "Members can view org leads OR own legacy leads" ON leads;
CREATE POLICY "Hybrid Access: Own or Org Leads"
  ON leads FOR SELECT
  USING (
    (user_id = auth.uid()) -- I own it
    OR
    (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())) -- Shared with my org
  );

DROP POLICY IF EXISTS "Users can insert org leads" ON leads;
CREATE POLICY "Hybrid Insert: Own or Org Leads"
  ON leads FOR INSERT
  WITH CHECK (
    (user_id = auth.uid())
    -- We allow inserting with org_id if we are a member
    AND
    (organization_id IS NULL OR organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "Members can update org leads" ON leads;
CREATE POLICY "Hybrid Update: Own or Org Leads"
  ON leads FOR UPDATE
  USING (
    (user_id = auth.uid()) OR
    (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "Members can delete org leads" ON leads;
CREATE POLICY "Hybrid Delete: Own or Org Leads"
  ON leads FOR DELETE
  USING (
    (user_id = auth.uid()) OR
    (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  );

-- CAMPAIGNS (Apply same logic)
DROP POLICY IF EXISTS "Members can view org campaigns" ON campaigns;
CREATE POLICY "Hybrid Access: Own or Org Campaigns"
  ON campaigns FOR SELECT
  USING (
    (user_id = auth.uid()) OR
    (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "Users can insert org campaigns" ON campaigns;
CREATE POLICY "Hybrid Insert: Own or Org Campaigns"
  ON campaigns FOR INSERT
  WITH CHECK (
    (user_id = auth.uid()) AND
    (organization_id IS NULL OR organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "Members can update org campaigns" ON campaigns;
CREATE POLICY "Hybrid Update: Own or Org Campaigns"
  ON campaigns FOR UPDATE
  USING (
    (user_id = auth.uid()) OR
    (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "Members can delete org campaigns" ON campaigns;
CREATE POLICY "Hybrid Delete: Own or Org Campaigns"
  ON campaigns FOR DELETE
  USING (
    (user_id = auth.uid()) OR
    (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  );

-- ENRICHED LEADS & CONTACTED LEADS
-- (Applying similar updates for consistency)

-- Enriched Leads
DROP POLICY IF EXISTS "Members can view org enriched leads" ON enriched_leads;
CREATE POLICY "Hybrid Access: Own or Org Enriched Leads"
  ON enriched_leads FOR SELECT
  USING (
    (user_id = auth.uid()) OR
    (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  );
-- (Insert/Update/Delete policies for enriched_leads usually follow similar patterns or are handled by service role, but let's be safe)
DROP POLICY IF EXISTS "Users can insert org enriched leads" ON enriched_leads;
CREATE POLICY "Hybrid Insert: Own or Org Enriched Leads"
  ON enriched_leads FOR INSERT
  WITH CHECK (
    (user_id = auth.uid()) AND
    (organization_id IS NULL OR organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  );


-- Contacted Leads
DROP POLICY IF EXISTS "Members can view org contacted leads" ON contacted_leads;
CREATE POLICY "Hybrid Access: Own or Org Contacted Leads"
  ON contacted_leads FOR SELECT
  USING (
    (user_id = auth.uid()) OR
    (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  );
DROP POLICY IF EXISTS "Users can insert org contacted leads" ON contacted_leads;
CREATE POLICY "Hybrid Insert: Own or Org Contacted Leads"
  ON contacted_leads FOR INSERT
  WITH CHECK (
    (user_id = auth.uid()) AND
    (organization_id IS NULL OR organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  );


-- 3. Profiles (Ensure strict User Ownership)
-- Profiles are strictly 1:1 with Auth Users. Org membership should NOT affect profile ownership.
-- Existing policies are:
-- "Authenticated users can view profiles" (Public read within app) -> OK
-- "Users can update their own profile" (Strict ownership) -> OK
-- No changes needed for Profiles, but good to verify.

-- 4. Rescue Orphaned Data (Optional but recommended)
-- If any data currently has a non-null organization_id that DOES NOT EXIST (because it was deleted before we added SET NULL),
-- we can't rescue it because it's already gone (if it was CASCADE).
-- If it was NO ACTION, it would have errored.
-- If it was SET NULL (unlikely), it's already safe.
-- We assume data might be gone if it was CASCADE.
-- However, we can ensure that any data with NULL organization_id is now visible to its owner (which the new policies do).

