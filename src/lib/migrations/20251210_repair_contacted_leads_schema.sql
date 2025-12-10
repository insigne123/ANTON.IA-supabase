-- REPAIR SCRIPT: Fix ALL missing columns in contacted_leads (FINAL)
-- Run this in the Supabase SQL Editor to fix the "Could not find..." errors.

-- 1. Essential Tracking Columns (Fixes crashes)
ALTER TABLE public.contacted_leads
ADD COLUMN IF NOT EXISTS last_update_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS last_step_idx INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS follow_up_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS campaign_id uuid,
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

-- 2. Extended Tracking (Clicks, Receipts)
ALTER TABLE public.contacted_leads
ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS read_receipt_message_id text,
ADD COLUMN IF NOT EXISTS delivery_receipt_message_id text,
ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- 3. Analytics Columns (Sector, Location)
ALTER TABLE public.contacted_leads
ADD COLUMN IF NOT EXISTS industry text,
ADD COLUMN IF NOT EXISTS city text,
ADD COLUMN IF NOT EXISTS country text,
ADD COLUMN IF NOT EXISTS role text,
ADD COLUMN IF NOT EXISTS name text,
ADD COLUMN IF NOT EXISTS email text,
ADD COLUMN IF NOT EXISTS company text;

-- 4. Refresh schema cache (Force PostgREST to see new columns)
NOTIFY pgrst, 'reload config';
