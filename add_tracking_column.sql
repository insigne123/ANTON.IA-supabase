ALTER TABLE antonia_config 
ADD COLUMN IF NOT EXISTS tracking_enabled BOOLEAN DEFAULT false;
