-- Add settings column to campaigns table
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;

-- Add variant_b column to campaign_steps table
ALTER TABLE campaign_steps 
ADD COLUMN IF NOT EXISTS variant_b JSONB DEFAULT NULL;

-- Example of variant_b structure:
-- {
--   "subject": "Hi...",
--   "bodyHtml": "...",
--   "attachments": [],
--   "weight": 0.5
-- }
