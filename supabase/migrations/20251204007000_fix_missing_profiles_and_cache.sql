-- Fix Missing Profiles and Schema Cache
-- This script repairs data inconsistencies caused by previous errors.

-- 1. Backfill Missing Profiles
-- Finds users in auth.users who do not have a corresponding row in public.profiles
INSERT INTO public.profiles (id, email, full_name, avatar_url)
SELECT 
  au.id, 
  au.email, 
  au.raw_user_meta_data->>'full_name', 
  au.raw_user_meta_data->>'avatar_url'
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE p.id IS NULL;

-- 2. Ensure Activity Logs Table is Correct
-- Re-run the creation just to be safe (IF NOT EXISTS handles it, but we want to ensure columns)
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

-- Ensure 'details' column exists (in case it was created without it previously)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_logs' AND column_name = 'details') THEN
    ALTER TABLE public.activity_logs ADD COLUMN details jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- 3. Verify Foreign Keys for PostgREST Embedding
-- Ensure activity_logs has a clear FK to profiles (via user_id) if we want to embed profiles
-- The existing FK references auth.users. PostgREST can use this if we select `users(...)` but we usually want `profiles(...)`.
-- We should add a FK to profiles if we want to embed `profiles`.
-- However, usually `user_id` referencing `auth.users` is enough if `profiles` also references `auth.users` with the same ID.
-- But for easier embedding, let's add a FK to profiles directly or rely on the fact that profiles.id = auth.users.id.
-- Actually, the error `Could not find a relationship between 'activity_logs' and 'user_id'` suggests it's looking for the table `user_id`? No, it says `between 'activity_logs' and 'user_id' in the schema cache`.
-- Wait, the error was: `Searched for a foreign key relationship between "public" and "activity_logs"`.
-- And `Could not find the "details" column`.

-- Let's explicitly add a FK to profiles to make embedding unambiguous
ALTER TABLE public.activity_logs 
DROP CONSTRAINT IF EXISTS activity_logs_user_id_fkey;

ALTER TABLE public.activity_logs
ADD CONSTRAINT activity_logs_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 4. Force Schema Cache Reload
NOTIFY pgrst, 'reload schema';
