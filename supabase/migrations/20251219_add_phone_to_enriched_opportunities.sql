-- Add phone number support to enriched_opportunities table
ALTER TABLE enriched_opportunities 
ADD COLUMN IF NOT EXISTS phone_numbers JSONB,
ADD COLUMN IF NOT EXISTS primary_phone TEXT,
ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT 'completed';

-- Optional: Create an index on enrichment_status if querying by it frequently
-- CREATE INDEX IF NOT EXISTS idx_enriched_opportunities_status ON enriched_opportunities(enrichment_status);
