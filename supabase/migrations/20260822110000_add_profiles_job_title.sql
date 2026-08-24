-- Profile editing and workflow context both use this sender-role field.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title text;
