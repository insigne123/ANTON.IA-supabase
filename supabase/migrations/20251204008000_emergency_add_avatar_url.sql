-- Emergency Fix: Add avatar_url and Repair Data
-- This script fixes the "column avatar_url does not exist" error and repairs the data.

-- 1. Ensure avatar_url column exists
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS avatar_url text;

-- 2. Backfill Missing Profiles (Safe Insert)
-- Finds users in auth.users who do not have a corresponding row in public.profiles
INSERT INTO public.profiles (id, email, full_name, avatar_url)
SELECT 
  au.id, 
  au.email, 
  au.raw_user_meta_data->>'full_name', 
  au.raw_user_meta_data->>'avatar_url'
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 3. Ensure Activity Logs Table is Correct
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

-- Ensure 'details' column exists in activity_logs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_logs' AND column_name = 'details') THEN
    ALTER TABLE public.activity_logs ADD COLUMN details jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- 4. Fix Foreign Key for Activity Logs (to avoid console errors)
ALTER TABLE public.activity_logs 
DROP CONSTRAINT IF EXISTS activity_logs_user_id_fkey;

-- We reference auth.users directly as it's the source of truth for user IDs
ALTER TABLE public.activity_logs
ADD CONSTRAINT activity_logs_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 5. Force Schema Cache Reload
NOTIFY pgrst, 'reload schema';
