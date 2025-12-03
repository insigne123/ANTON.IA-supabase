-- Fix missing INSERT policy for organizations table
-- This resolves the "new row violates row-level security policy" error when creating an organization

-- 1. Allow authenticated users to create organizations
CREATE POLICY "Users can create organizations"
  ON organizations FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 2. Allow owners to delete their organizations
CREATE POLICY "Owners can delete their organizations"
  ON organizations FOR DELETE
  USING (
    id IN (
      SELECT organization_id 
      FROM organization_members 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );
