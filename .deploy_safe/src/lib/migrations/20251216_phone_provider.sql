
-- Migration: Allow 'phone' in contacted_leads provider check constraint
-- Created at: 2025-12-16

-- Check if there is an existing check constraint on provider and drop it if necessary to add the new one.
-- Or just alter the type if it is an ENUM. Assuming text with check constraint for now based on typical setup.

ALTER TABLE contacted_leads DROP CONSTRAINT IF EXISTS contacted_leads_provider_check;

ALTER TABLE contacted_leads
  ADD CONSTRAINT contacted_leads_provider_check 
  CHECK (provider IN ('gmail', 'outlook', 'linkedin', 'phone'));
