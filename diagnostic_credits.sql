-- Diagnostic script to check User -> Org -> Credits
-- Run this in Supabase SQL Editor

DO $$
DECLARE
  target_user_id UUID; -- We will try to find a user, or use a specific one if known
  org_id UUID;
  credits INTEGER;
  enabled BOOLEAN;
BEGIN
  -- 1. Get a recent user (or specific one if you know the ID)
  SELECT id INTO target_user_id FROM auth.users ORDER BY last_sign_in_at DESC LIMIT 1;
  
  RAISE NOTICE 'Diagnosing for User ID: %', target_user_id;

  -- 2. Check Organization Membership
  SELECT organization_id INTO org_id
  FROM organization_members
  WHERE user_id = target_user_id
  LIMIT 1;

  IF org_id IS NULL THEN
    RAISE NOTICE '❌ ERROR: User has NO organization_members record.';
  ELSE
    RAISE NOTICE '✅ User belongs to Organization ID: %', org_id;
    
    -- 3. Check Organization Credits
    SELECT social_search_credits, feature_social_search_enabled 
    INTO credits, enabled
    FROM organizations
    WHERE id = org_id;

    RAISE NOTICE '   Credits: % (Expected > 0)', credits;
    RAISE NOTICE '   Enabled: % (Expected true)', enabled;

    IF credits > 0 AND enabled THEN
       RAISE NOTICE '✅ Social Search SHOULD work.';
    ELSE
       RAISE NOTICE '❌ Social Search will be SKIPPED (credits=0 or disabled).';
    END IF;
  END IF;

END $$;
