-- MASTER FIX: Resolve RLS Recursion and Organization Creation Issues

-- 1. Create a secure RPC function to create organizations
-- This avoids the RLS race condition where a user creates an org but can't see it yet
CREATE OR REPLACE FUNCTION create_new_organization(org_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
BEGIN
  -- 1. Create Organization
  INSERT INTO organizations (name)
  VALUES (org_name)
  RETURNING id INTO new_org_id;

  -- 2. Add Current User as Owner
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (new_org_id, auth.uid(), 'owner');

  RETURN new_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_new_organization(text) TO authenticated;

-- 2. Fix RLS Infinite Recursion (Forcefully drop and recreate)

-- Helper function (idempotent)
CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS setof uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION get_user_org_ids() TO authenticated, service_role;

-- Clean slate: Drop potentially problematic policies
DROP POLICY IF EXISTS "Members can view their organizations" ON organizations;
DROP POLICY IF EXISTS "Owners can update their organizations" ON organizations;
DROP POLICY IF EXISTS "Users can create organizations" ON organizations;
DROP POLICY IF EXISTS "Owners can delete their organizations" ON organizations;

DROP POLICY IF EXISTS "Members can view members of their organizations" ON organization_members;
DROP POLICY IF EXISTS "Users can insert themselves" ON organization_members;
DROP POLICY IF EXISTS "Owners can manage members" ON organization_members;

-- Re-create Policies for ORGANIZATIONS

-- View: Only if you are a member
CREATE POLICY "Members can view their organizations"
  ON organizations FOR SELECT
  USING (
    id IN (SELECT get_user_org_ids())
  );

-- Update: Only if you are an owner
CREATE POLICY "Owners can update their organizations"
  ON organizations FOR UPDATE
  USING (
    id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Delete: Only if you are an owner
CREATE POLICY "Owners can delete their organizations"
  ON organizations FOR DELETE
  USING (
    id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Re-create Policies for ORGANIZATION_MEMBERS

-- View: See members of your organizations (Non-recursive using function)
CREATE POLICY "Members can view members of their organizations"
  ON organization_members FOR SELECT
  USING (
    organization_id IN (SELECT get_user_org_ids())
  );

-- Insert: Users can add themselves (needed for invites or join flows if any, though RPC handles creation)
CREATE POLICY "Users can insert themselves"
  ON organization_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
  );

-- Manage: Owners can do everything with members of their orgs
CREATE POLICY "Owners can manage members"
  ON organization_members FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );
