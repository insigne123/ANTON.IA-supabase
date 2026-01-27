-- Add apollo_id to leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS apollo_id text;

-- Add index for faster lookups if we deduplicate by it later
CREATE INDEX IF NOT EXISTS leads_apollo_id_idx ON leads(apollo_id);

-- Force cache refresh (comment to ensure file change is detected)
NOTIFY pgrst, 'reload config';
