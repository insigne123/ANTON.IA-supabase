-- NUCLEAR FIX for Activity Logs Foreign Key
-- Run this script to FORCE the correct relationship structure.

BEGIN;

-- 1. Drop ANY existing constraint on user_id (try common names)
ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_user_id_fkey;
ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_user_id_fkey1;
ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS fk_activity_logs_user;

-- 2. Force the column type to match profiles.id (uuid)
ALTER TABLE public.activity_logs 
ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- 3. Create the constraint with the EXACT name we are using in the code
ALTER TABLE public.activity_logs
ADD CONSTRAINT activity_logs_user_id_fkey
FOREIGN KEY (user_id) 
REFERENCES public.profiles(id) 
ON DELETE SET NULL;

-- 4. Grant permissions to ensure PostgREST can see it
GRANT REFERENCES ON TABLE public.profiles TO authenticated;
GRANT REFERENCES ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.profiles TO service_role;

COMMIT;

-- 5. Force Schema Cache Reload (outside transaction block usually, but works here for Supabase)
NOTIFY pgrst, 'reload schema';
