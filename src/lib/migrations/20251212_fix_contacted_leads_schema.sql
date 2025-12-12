-- Add missing columns to contacted_leads for Gmail/Outlook integration and Tracking
ALTER TABLE public.contacted_leads
ADD COLUMN IF NOT EXISTS thread_id text,
ADD COLUMN IF NOT EXISTS message_id text,
ADD COLUMN IF NOT EXISTS conversation_id text,
ADD COLUMN IF NOT EXISTS internet_message_id text,
ADD COLUMN IF NOT EXISTS provider text,
ADD COLUMN IF NOT EXISTS last_reply_text text,
ADD COLUMN IF NOT EXISTS replied_at timestamptz,
ADD COLUMN IF NOT EXISTS opened_at timestamptz,
ADD COLUMN IF NOT EXISTS clicked_at timestamptz,
ADD COLUMN IF NOT EXISTS click_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
ADD COLUMN IF NOT EXISTS read_receipt_message_id text,
ADD COLUMN IF NOT EXISTS delivery_receipt_message_id text,
ADD COLUMN IF NOT EXISTS follow_up_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_follow_up_at timestamptz,
ADD COLUMN IF NOT EXISTS last_step_idx integer DEFAULT -1,
ADD COLUMN IF NOT EXISTS reply_preview text,
ADD COLUMN IF NOT EXISTS last_update_at timestamptz DEFAULT now();

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_contacted_leads_thread_id ON public.contacted_leads (thread_id);
CREATE INDEX IF NOT EXISTS idx_contacted_leads_message_id ON public.contacted_leads (message_id);
