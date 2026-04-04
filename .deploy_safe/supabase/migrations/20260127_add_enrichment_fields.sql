-- Add new enrichment fields to enriched_leads table
-- These fields come from the new consolidated enrichment API

-- Location fields
ALTER TABLE public.enriched_leads 
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS city text;

-- Professional info fields
ALTER TABLE public.enriched_leads
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS seniority text,
  ADD COLUMN IF NOT EXISTS departments jsonb;

-- Email status (may already exist in data jsonb, but making it a proper column)
ALTER TABLE public.enriched_leads
  ADD COLUMN IF NOT EXISTS email_status text;

-- Organization fields
ALTER TABLE public.enriched_leads
  ADD COLUMN IF NOT EXISTS organization_domain text,
  ADD COLUMN IF NOT EXISTS organization_industry text,
  ADD COLUMN IF NOT EXISTS organization_size integer;

-- Update timestamp
ALTER TABLE public.enriched_leads
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Create index on commonly queried fields
CREATE INDEX IF NOT EXISTS idx_enriched_leads_country ON public.enriched_leads(country);
CREATE INDEX IF NOT EXISTS idx_enriched_leads_organization_domain ON public.enriched_leads(organization_domain);
CREATE INDEX IF NOT EXISTS idx_enriched_leads_email_status ON public.enriched_leads(email_status);

-- Add comment for documentation
COMMENT ON COLUMN public.enriched_leads.state IS 'State/Province from Apollo enrichment';
COMMENT ON COLUMN public.enriched_leads.country IS 'Country from Apollo enrichment';
COMMENT ON COLUMN public.enriched_leads.city IS 'City from Apollo enrichment';
COMMENT ON COLUMN public.enriched_leads.headline IS 'Professional headline from Apollo';
COMMENT ON COLUMN public.enriched_leads.photo_url IS 'Profile photo URL from Apollo';
COMMENT ON COLUMN public.enriched_leads.seniority IS 'Seniority level (e.g., senior, entry, manager)';
COMMENT ON COLUMN public.enriched_leads.departments IS 'Array of departments as JSONB';
COMMENT ON COLUMN public.enriched_leads.email_status IS 'Email verification status (verified, guessed, locked, unknown)';
COMMENT ON COLUMN public.enriched_leads.organization_domain IS 'Company domain';
COMMENT ON COLUMN public.enriched_leads.organization_industry IS 'Company industry';
COMMENT ON COLUMN public.enriched_leads.organization_size IS 'Number of employees';
