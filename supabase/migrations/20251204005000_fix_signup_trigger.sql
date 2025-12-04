-- Fix Signup Trigger and Add Organization Creation
-- This migration replaces the handle_new_user function to ensure it:
-- 1. Creates a profile safely.
-- 2. Creates a default organization for the new user.
-- 3. Adds the user as the owner of that organization.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
  user_full_name text;
  user_avatar_url text;
BEGIN
  -- Extract metadata safely
  user_full_name := new.raw_user_meta_data->>'full_name';
  user_avatar_url := new.raw_user_meta_data->>'avatar_url';

  -- 1. Create Profile
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    new.id, 
    new.email, 
    user_full_name, 
    user_avatar_url
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url);

  -- 2. Create Default Organization
  -- We use a simple name like "Email's Org" or "My Organization"
  INSERT INTO public.organizations (name)
  VALUES (
    COALESCE(user_full_name, split_part(new.email, '@', 1)) || '''s Organization'
  )
  RETURNING id INTO new_org_id;

  -- 3. Add User as Owner
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org_id, new.id, 'owner');

  -- 4. Log Activity (Optional, but good for debugging)
  -- We can't easily use the service here, but we can insert directly if the table exists
  BEGIN
    INSERT INTO public.activity_logs (organization_id, user_id, action, entity_type, entity_id, details)
    VALUES (
      new_org_id, 
      new.id, 
      'create_organization', 
      'organization', 
      new_org_id, 
      jsonb_build_object('source', 'signup_trigger')
    );
  EXCEPTION WHEN OTHERS THEN
    -- Ignore logging errors during signup to prevent blocking account creation
    NULL;
  END;

  RETURN new;
EXCEPTION WHEN OTHERS THEN
  -- Log error (visible in Supabase logs)
  RAISE WARNING 'Error in handle_new_user trigger: %', SQLERRM;
  -- We usually don't want to block signup, but if profile/org creation fails, the app might break.
  -- For now, we return new so the user is created, but they might have missing data.
  -- Alternatively, re-raising the error (RAISE EXCEPTION) causes the 500 error the user saw.
  -- Let's try to return NEW to allow login, and the user can potentially retry setup later.
  -- BUT, if we return NEW without creating org, they get stuck.
  -- Better to fail loud if we can't create the org, but maybe the previous error was due to something trivial.
  -- Let's re-raise for now to ensure data integrity, but the improved logic above should fix the root cause.
  RAISE EXCEPTION 'Failed to initialize user account: %', SQLERRM;
END;
$$;

-- Ensure trigger is enabled
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Force schema cache reload
NOTIFY pgrst, 'reload schema';
