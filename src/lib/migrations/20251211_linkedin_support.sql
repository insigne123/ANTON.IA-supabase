-- Add LinkedIn support to contacted_leads

-- 1. Updates provider check constraint to allow 'linkedin'
-- We drop the old check if it exists (names may vary, so we try standard naming)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacted_leads_provider_check') THEN
        ALTER TABLE public.contacted_leads DROP CONSTRAINT contacted_leads_provider_check;
    END IF;
END $$;

ALTER TABLE public.contacted_leads
    ADD CONSTRAINT contacted_leads_provider_check 
    CHECK (provider IN ('gmail', 'outlook', 'linkedin'));

-- 2. Add LinkedIn specific tracking columns
ALTER TABLE public.contacted_leads
    ADD COLUMN IF NOT EXISTS linkedin_thread_url TEXT,
    ADD COLUMN IF NOT EXISTS linkedin_message_status TEXT DEFAULT 'sent'; -- 'sent', 'queued', 'failed', 'replied'

-- 3. Notify Schema Reload
NOTIFY pgrst, 'reload config';
