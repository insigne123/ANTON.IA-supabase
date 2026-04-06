-- Add click tracking columns to contacted_leads
ALTER TABLE contacted_leads 
ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 0;

-- Notify pgrst to reload schema
NOTIFY pgrst, 'reload config';
