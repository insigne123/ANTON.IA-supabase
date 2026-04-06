-- Ultimate Signup Fix
-- This script ensures all necessary tables exist and resets the signup trigger to a known good state.

-- 1. Ensure Tables Exist (Idempotent)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email text,
  full_name text,
  avatar_url text,
  company_name text,
  company_domain text,
  signatures jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable RLS (just in case)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing trigger and function to avoid conflicts
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 4. Create the robust function
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

  -- A. Create Profile
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error creating profile for user %: %', new.id, SQLERRM;
    -- Continue execution, don't fail yet
  END;

  -- B. Create Default Organization
  BEGIN
    INSERT INTO public.organizations (name)
    VALUES (
      COALESCE(user_full_name, split_part(new.email, '@', 1)) || '''s Organization'
    )
    RETURNING id INTO new_org_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error creating organization for user %: %', new.id, SQLERRM;
    -- If org creation fails, we can't add member. Stop here?
    -- Let's try to return NEW so user is created, even if org fails.
    RETURN new;
  END;

  -- C. Add User as Owner
  BEGIN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (new_org_id, new.id, 'owner');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error adding member to org %: %', new_org_id, SQLERRM;
  END;

  -- D. Log Activity
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
    -- Ignore logging errors
    NULL;
  END;

  RETURN new;
EXCEPTION WHEN OTHERS THEN
  -- Catch-all for any other unexpected errors
  RAISE WARNING 'Unexpected error in handle_new_user: %', SQLERRM;
  RETURN new; -- Ensure user creation succeeds no matter what
END;
$$;

-- 5. Re-create Trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 6. Force schema cache reload
NOTIFY pgrst, 'reload schema';
