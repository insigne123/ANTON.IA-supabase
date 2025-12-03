-- Emergency Fix for Leads Visibility
-- This script ensures that:
-- 1. Every user has at least one organization.
-- 2. All leads are assigned to an organization.
-- 3. RLS policies are permissive enough to show leads even if something goes wrong with org assignment.

-- 1. Ensure every user has an organization
DO $$
DECLARE
    user_record RECORD;
    new_org_id uuid;
BEGIN
    FOR user_record IN SELECT id, email FROM auth.users LOOP
        -- Check if user has an organization
        IF NOT EXISTS (SELECT 1 FROM organization_members WHERE user_id = user_record.id) THEN
            -- Create organization
            INSERT INTO organizations (name)
            VALUES (COALESCE(user_record.email, 'My Organization'))
            RETURNING id INTO new_org_id;

            -- Add user as owner
            INSERT INTO organization_members (organization_id, user_id, role)
            VALUES (new_org_id, user_record.id, 'owner');
            
            RAISE NOTICE 'Created organization for user %', user_record.id;
        END IF;
    END LOOP;
END $$;

-- 2. Force backfill organization_id for ALL leads
-- (This runs again to catch any that were missed or if the user just got an org created above)
UPDATE leads l
SET organization_id = (
    SELECT organization_id 
    FROM organization_members om 
    WHERE om.user_id = l.user_id 
    ORDER BY created_at ASC -- Use the oldest org (likely the first created)
    LIMIT 1
)
WHERE l.organization_id IS NULL;

-- 3. Update RLS Policy for Leads to be MORE PERMISSIVE (Fallback)
-- Allow seeing leads if they belong to your org OR if you own them and they have no org (legacy fallback)
DROP POLICY IF EXISTS "Members can view org leads" ON leads;

CREATE POLICY "Members can view org leads OR own legacy leads"
  ON leads FOR SELECT
  USING (
    (organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    ))
    OR
    (organization_id IS NULL AND user_id = auth.uid())
  );

-- Re-apply other policies with similar logic
DROP POLICY IF EXISTS "Users can insert org leads" ON leads;
CREATE POLICY "Users can insert org leads"
  ON leads FOR INSERT
  WITH CHECK (
    (organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    ))
    OR
    (organization_id IS NULL AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Members can update org leads" ON leads;
CREATE POLICY "Members can update org leads"
  ON leads FOR UPDATE
  USING (
    (organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    ))
    OR
    (organization_id IS NULL AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Members can delete org leads" ON leads;
CREATE POLICY "Members can delete org leads"
  ON leads FOR DELETE
  USING (
    (organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    ))
    OR
    (organization_id IS NULL AND user_id = auth.uid())
  );
