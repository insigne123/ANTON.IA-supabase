-- Fix Activity Log FK for Profiles Embedding
-- This script changes the foreign key of activity_logs.user_id to reference public.profiles(id)
-- This allows PostgREST to correctly embed profiles using the user_id column.

-- 1. Drop existing FK
ALTER TABLE public.activity_logs 
DROP CONSTRAINT IF EXISTS activity_logs_user_id_fkey;

-- 2. Add new FK referencing profiles
-- Since profiles.id is a FK to auth.users.id, this is safe and correct 1:1 mapping.
ALTER TABLE public.activity_logs
ADD CONSTRAINT activity_logs_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3. Force Schema Cache Reload
NOTIFY pgrst, 'reload schema';
