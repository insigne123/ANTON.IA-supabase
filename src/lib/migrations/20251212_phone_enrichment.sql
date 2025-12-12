-- Migration: Add phone number columns to enriched_leads
-- Description: Support for Apollo phone number enrichment
-- Created at: 2025-12-12

ALTER TABLE enriched_leads 
ADD COLUMN IF NOT EXISTS phone_numbers JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS primary_phone TEXT DEFAULT NULL;

-- Optional: Add standard index using trigram for phone search if needed later using pg_trgm
-- CREATE INDEX IF NOT EXISTS idx_enriched_leads_primary_phone ON enriched_leads USING GIN (primary_phone gin_trgm_ops);
