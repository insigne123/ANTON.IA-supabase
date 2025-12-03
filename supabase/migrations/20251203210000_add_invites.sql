-- Create organization_invites table
CREATE TABLE IF NOT EXISTS organization_invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  role text DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  expires_at timestamp with time zone DEFAULT (timezone('utc'::text, now()) + interval '7 days') NOT NULL,
  UNIQUE(email, organization_id)
);

-- Enable RLS
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

-- Policies

-- View: Members can view invites for their organization
CREATE POLICY "Members can view invites"
  ON organization_invites FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- Create: Only owners/admins can create invites
CREATE POLICY "Admins can create invites"
  ON organization_invites FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Delete: Only owners/admins can delete (revoke) invites
CREATE POLICY "Admins can delete invites"
  ON organization_invites FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Function to accept an invite
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

  -- Verify email matches current user
  SELECT email INTO user_email FROM auth.users WHERE id = auth.uid();
  
  IF lower(invite_record.email) != lower(user_email) THEN
    RAISE EXCEPTION 'This invite is for a different email address';
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

GRANT EXECUTE ON FUNCTION accept_invite(text) TO authenticated;
