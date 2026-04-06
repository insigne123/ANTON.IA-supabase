-- Create or replace the function to decrement social search credits safely
-- This function ensures atomic updates and prevents negative balances.

CREATE OR REPLACE FUNCTION public.decrement_social_credit(org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_credits integer;
  new_credits integer;
BEGIN
  -- Lock the row for the organization to prevent race conditions
  SELECT social_search_credits INTO current_credits
  FROM public.organizations
  WHERE id = org_id
  FOR UPDATE;

  -- If organization doesn't exist or has no credits, return -1 (error/none)
  IF current_credits IS NULL OR current_credits <= 0 THEN
    RETURN -1;
  END IF;

  -- Calculate new balance
  new_credits := current_credits - 1;

  -- Update the organization
  UPDATE public.organizations
  SET social_search_credits = new_credits
  WHERE id = org_id;

  -- Return the new balance
  RETURN new_credits;
END;
$$;
