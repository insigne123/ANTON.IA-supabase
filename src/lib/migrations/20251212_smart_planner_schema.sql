-- Add 'scheduled_at' column to store when the message should be sent
ALTER TABLE public.contacted_leads
ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NULL;

-- Update status check constraint to include 'scheduled'
-- We first drop the existing constraint if we know its name, or we can use a DO block to be safe.
-- Assuming standard naming 'conversation_status_check' or 'contacted_leads_status_check' based on Supabase defaults.
-- But since names vary, dropping specifically the constraint on 'status' is safer via DO block or just adding the constraint if it doesn't exist.

DO $$
BEGIN
    -- Try to drop constraint if it exists (guessing common names)
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacted_leads_status_check') THEN
        ALTER TABLE public.contacted_leads DROP CONSTRAINT contacted_leads_status_check;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_status_check') THEN
         ALTER TABLE public.contacted_leads DROP CONSTRAINT conversation_status_check;
    END IF;
END $$;

-- Re-apply strictly. Note: 'sent' and 'replied' were existing. We add 'scheduled'.
ALTER TABLE public.contacted_leads
ADD CONSTRAINT contacted_leads_status_check
CHECK (status IN ('sent', 'replied', 'scheduled', 'failed', 'queued'));
