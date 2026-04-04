-- Add missing columns used by the Campaigns UI/service layer.
-- These are safe, additive changes.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sent_records jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.campaign_steps
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS variant_b jsonb;

-- Backfill step names for existing rows.
UPDATE public.campaign_steps
SET name = COALESCE(name, 'Paso ' || (order_index + 1))
WHERE name IS NULL;
