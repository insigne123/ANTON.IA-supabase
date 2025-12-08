-- Add missing columns to contacted_leads to support new tracking features
ALTER TABLE public.contacted_leads
ADD COLUMN IF NOT EXISTS company text,
ADD COLUMN IF NOT EXISTS role text,
ADD COLUMN IF NOT EXISTS name text,
ADD COLUMN IF NOT EXISTS email text;

-- Also add organization_id if it's missing, as we seem to be moving to org-based structure
ALTER TABLE public.contacted_leads
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

-- Update RLS for organization (optional but good practice)
-- (Assuming standard org policy exists, but let's stick to columns for now to fix the crash)
