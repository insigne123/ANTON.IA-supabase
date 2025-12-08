-- Add job_title to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS job_title TEXT;
