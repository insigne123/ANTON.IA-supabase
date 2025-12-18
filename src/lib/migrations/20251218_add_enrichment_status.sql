-- Add enrichment_status column to enriched_leads table
ALTER TABLE enriched_leads 
ADD COLUMN IF NOT EXISTS enrichment_status text DEFAULT 'completed';

-- Optional: Add check constraint if we want to restrict values, 
-- but text is flexible for future statuses (e.g. 'failed', 'partial')
-- ALTER TABLE enriched_leads ADD CONSTRAINT check_enrichment_status 
-- CHECK (enrichment_status IN ('pending_phone', 'completed', 'failed'));

COMMENT ON COLUMN enriched_leads.enrichment_status IS 'Status of the enrichment process: pending_phone, completed, failed';
