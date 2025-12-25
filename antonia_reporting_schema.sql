-- Migration: Antonia Reporting System & Mission Tracking

-- 1. Create antonia_reports table
CREATE TABLE IF NOT EXISTS public.antonia_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mission_id uuid REFERENCES public.antonia_missions(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('daily', 'weekly', 'mission_historic')),
  content text, -- HTML content
  summary_data jsonb, -- Raw metrics snapshot
  sent_to text[], -- Array of email addresses
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.antonia_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies for antonia_reports
DROP POLICY IF EXISTS "Members can view org reports" ON public.antonia_reports;
CREATE POLICY "Members can view org reports" ON public.antonia_reports
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
  );

-- Service role full access
DROP POLICY IF EXISTS "Service role manages reports" ON public.antonia_reports;
CREATE POLICY "Service role manages reports" ON public.antonia_reports
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- 2. Add mission_id tracking to Leads tables

-- Leads table (assuming public.leads exists)
DO $$ 
BEGIN 
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'leads') THEN
    ALTER TABLE public.leads 
    ADD COLUMN IF NOT EXISTS mission_id uuid REFERENCES public.antonia_missions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Contacted Leads table
ALTER TABLE public.contacted_leads 
ADD COLUMN IF NOT EXISTS mission_id uuid REFERENCES public.antonia_missions(id) ON DELETE SET NULL;

-- Enriched Leads table (if distinct)
DO $$ 
BEGIN 
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'enriched_leads') THEN
    ALTER TABLE public.enriched_leads 
    ADD COLUMN IF NOT EXISTS mission_id uuid REFERENCES public.antonia_missions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Create Indexes for Reporting Performance
CREATE INDEX IF NOT EXISTS idx_antonia_reports_org_type ON public.antonia_reports(organization_id, type);
CREATE INDEX IF NOT EXISTS idx_antonia_reports_mission ON public.antonia_reports(mission_id);

-- Indexes for Mission Tracking lookups
-- Note: conditional execution for 'leads' index handled by IF EXISTS check is tricky in SQL script blocks, 
-- but creating index on non-existent table fails.
-- We assume 'leads' exists based on app logic.
CREATE INDEX IF NOT EXISTS idx_leads_mission_id ON public.leads(mission_id);
CREATE INDEX IF NOT EXISTS idx_contacted_leads_mission_id ON public.contacted_leads(mission_id);
