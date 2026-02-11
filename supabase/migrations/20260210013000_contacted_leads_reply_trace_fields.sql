alter table public.contacted_leads
  add column if not exists reply_message_id text,
  add column if not exists reply_subject text,
  add column if not exists reply_snippet text;

create index if not exists contacted_leads_reply_message_id_idx
  on public.contacted_leads(reply_message_id)
  where reply_message_id is not null;

notify pgrst, 'reload config';
