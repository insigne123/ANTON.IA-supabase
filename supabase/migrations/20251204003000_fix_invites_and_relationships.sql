-- Fix Invites and Relationships
-- 1. Add explicit FK to profiles to allow PostgREST embedding
-- This resolves "Could not find a relationship between 'organization_members' and 'user_id'"
ALTER TABLE organization_members
DROP CONSTRAINT IF EXISTS fk_profiles;

ALTER TABLE organization_members
ADD CONSTRAINT fk_profiles
FOREIGN KEY (user_id)
REFERENCES profiles(id)
ON DELETE CASCADE;

-- 2. Improve accept_invite function
CREATE OR REPLACE FUNCTION accept_invite(invite_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite_record record;
  user_email text;
BEGIN
  -- Get the invite
  SELECT * INTO invite_record FROM organization_invites WHERE token = invite_token;
  
  IF invite_record IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite token';
  END IF;

  IF invite_record.expires_at < now() THEN
    RAISE EXCEPTION 'Invite has expired';
  END IF;

  -- Check if user is ALREADY a member
  IF EXISTS (
      SELECT 1 FROM organization_members 
      WHERE organization_id = invite_record.organization_id 
      AND user_id = auth.uid()
  ) THEN
      -- Already a member, just clean up the invite and return success
      DELETE FROM organization_invites WHERE id = invite_record.id;
      RETURN true;
  END IF;

  -- Verify email matches current user (Case insensitive and trimmed)
  SELECT email INTO user_email FROM auth.users WHERE id = auth.uid();
  
  IF TRIM(lower(invite_record.email)) != TRIM(lower(user_email)) THEN
    RAISE EXCEPTION 'This invite is for a different email address. You are logged in as %, but the invite is for %.', user_email, invite_record.email;
  END IF;

  -- Add to organization
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (invite_record.organization_id, auth.uid(), invite_record.role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  -- Delete invite
  DELETE FROM organization_invites WHERE id = invite_record.id;

  RETURN true;
END;
$$;

-- 3. Force schema cache reload
NOTIFY pgrst, 'reload schema';
