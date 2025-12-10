-- REPAIR SCRIPT: Fix all missing columns in contacted_leads
-- Run this in the Supabase SQL Editor to fix the "Could not find..." errors.

-- 1. Tracking columns (Fixes the crash)
ALTER TABLE public.contacted_leads
ADD COLUMN IF NOT EXISTS last_step_idx INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS follow_up_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS campaign_id uuid,
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

-- 2. Analytics columns (Fixes the "Sector" charts)
ALTER TABLE public.contacted_leads
ADD COLUMN IF NOT EXISTS industry text,
ADD COLUMN IF NOT EXISTS city text,
ADD COLUMN IF NOT EXISTS country text,
ADD COLUMN IF NOT EXISTS role text,
ADD COLUMN IF NOT EXISTS name text,
ADD COLUMN IF NOT EXISTS email text,
ADD COLUMN IF NOT EXISTS company text;

-- 3. Refresh schema cache (Force PostgREST to see new columns)
NOTIFY pgrst, 'reload config';
