-- Keep the inbound reply RPC valid on installations where legacy LinkedIn
-- support was created outside the Supabase migration history.

alter table public.contacted_leads
  add column if not exists linkedin_message_status text default 'sent';

notify pgrst, 'reload schema';
