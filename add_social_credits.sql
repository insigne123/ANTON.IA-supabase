-- Add columns if they don't exist
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS social_search_credits INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS feature_social_search_enabled BOOLEAN DEFAULT true;

-- Create atomic decrement function
CREATE OR REPLACE FUNCTION decrement_social_credit(org_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_credits INTEGER;
  new_credits INTEGER;
BEGIN
  -- Lock the row for update
  SELECT social_search_credits INTO current_credits
  FROM organizations
  WHERE id = org_id
  FOR UPDATE;

  IF current_credits > 0 THEN
    new_credits := current_credits - 1;
    UPDATE organizations
    SET social_search_credits = new_credits
    WHERE id = org_id;
    RETURN new_credits;
  ELSE
    RETURN 0;
  END IF;
END;
$$;
