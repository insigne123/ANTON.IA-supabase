-- Migration: Add 'connected' field to integration_tokens table
-- This field tracks whether a user has successfully connected an OAuth provider

-- Add connected column (defaults to true for existing records)
ALTER TABLE integration_tokens 
ADD COLUMN IF NOT EXISTS connected boolean DEFAULT true;

-- Make refresh_token nullable (since we're just tracking connection status for now)
ALTER TABLE integration_tokens 
ALTER COLUMN refresh_token DROP NOT NULL;

-- Update existing records to have connected = true
UPDATE integration_tokens SET connected = true WHERE connected IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN integration_tokens.connected IS 'Indicates if the OAuth provider is currently connected';
COMMENT ON COLUMN integration_tokens.refresh_token IS 'Encrypted refresh token for server-side email sending (optional)';
