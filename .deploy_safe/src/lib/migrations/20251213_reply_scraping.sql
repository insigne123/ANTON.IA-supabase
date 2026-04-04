-- Add last_reply_text to contacted_leads
ALTER TABLE public.contacted_leads
ADD COLUMN IF NOT EXISTS "last_reply_text" TEXT DEFAULT NULL;

-- Ensure status can be 'replied' (already done in previous check, but good to verify)
-- If we missed it, we can add it here.
-- CHECK (status IN ('saved', 'investigated', 'contacted', 'sent', 'replied', 'scheduled', 'queued', 'failed'))
