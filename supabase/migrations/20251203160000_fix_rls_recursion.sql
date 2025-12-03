-- Fix infinite recursion in RLS policies by using a security definer function

-- 1. Create a security definer function to get user's organizations
-- This bypasses RLS on organization_members to avoid recursion
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

-- 2. Fix organization_members policies

-- Drop existing recursive policy
DROP POLICY IF EXISTS "Members can view members of their organizations" ON organization_members;

-- Create new non-recursive SELECT policy
CREATE POLICY "Members can view members of their organizations"
  ON organization_members FOR SELECT
  USING (
    organization_id IN (SELECT get_user_org_ids())
  );

-- Add INSERT policy (needed for org creation)
-- Allows users to add themselves (e.g. when creating an org)
CREATE POLICY "Users can insert themselves"
  ON organization_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
  );

-- Add UPDATE/DELETE policies for Owners
CREATE POLICY "Owners can manage members"
  ON organization_members FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- 3. Optimize organizations policies to use the function
DROP POLICY IF EXISTS "Members can view their organizations" ON organizations;

CREATE POLICY "Members can view their organizations"
  ON organizations FOR SELECT
  USING (
    id IN (SELECT get_user_org_ids())
  );
