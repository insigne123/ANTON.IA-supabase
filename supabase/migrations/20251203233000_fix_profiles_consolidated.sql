-- Consolidated Fix for Profiles Table
-- This script ensures the profiles table exists and has all necessary columns.

-- 1. Create table if it doesn't exist (with base columns)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Add potentially missing columns (idempotent)
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS full_name text,
ADD COLUMN IF NOT EXISTS company_name text,
ADD COLUMN IF NOT EXISTS company_domain text,
ADD COLUMN IF NOT EXISTS signatures jsonb DEFAULT '{}'::jsonb;

-- 3. Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 4. Re-apply policies (drop first to avoid errors)
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON profiles;
CREATE POLICY "Authenticated users can view profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- 5. Ensure trigger exists
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    new.id, 
    new.email, 
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING; -- Prevent errors if profile already exists
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 6. Backfill missing profiles
INSERT INTO public.profiles (id, email, full_name)
SELECT 
  id, 
  email, 
  raw_user_meta_data->>'full_name'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 7. Force schema cache reload (by notifying PostgREST)
NOTIFY pgrst, 'reload schema';
