-- Add columns for analytics (Sector, Location)
ALTER TABLE public.contacted_leads
ADD COLUMN IF NOT EXISTS industry text,
ADD COLUMN IF NOT EXISTS city text,
ADD COLUMN IF NOT EXISTS country text;
