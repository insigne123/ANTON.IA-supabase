-- EMERGENCY FIX: Simplify RLS to absolute minimum to break recursion

-- 1. Drop ALL existing policies on organization_members to be safe
DROP POLICY IF EXISTS "Members can view members of their organizations" ON organization_members;
DROP POLICY IF EXISTS "Users can insert themselves" ON organization_members;
DROP POLICY IF EXISTS "Owners can manage members" ON organization_members;
DROP POLICY IF EXISTS "Members can view their organizations" ON organizations;

-- 2. Create SIMPLE, NON-RECURSIVE policies

-- Organization Members:
-- Users can see rows where they are the user (see own membership)
CREATE POLICY "View own membership"
  ON organization_members FOR SELECT
  USING (user_id = auth.uid());

-- Users can see rows for organizations they are a member of (RECURSIVE IF NOT CAREFUL)
-- Instead of complex logic, let's use a SECURITY DEFINER function that is GUARANTEED to work
-- We will redefine the function to be absolutely simple and robust

CREATE OR REPLACE FUNCTION get_my_org_ids()
RETURNS setof uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION get_my_org_ids() TO authenticated, service_role;

-- Now use this function for the policy. 
-- The function runs as owner (superuser), so it bypasses RLS on organization_members.
-- This breaks the recursion.

CREATE POLICY "View members of my orgs"
  ON organization_members FOR SELECT
  USING (
    organization_id IN (SELECT get_my_org_ids())
  );

CREATE POLICY "Insert self"
  ON organization_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Organizations:
CREATE POLICY "View my orgs"
  ON organizations FOR SELECT
  USING (
    id IN (SELECT get_my_org_ids())
  );

-- 3. Grant permissions just in case
GRANT ALL ON organizations TO authenticated;
GRANT ALL ON organization_members TO authenticated;
