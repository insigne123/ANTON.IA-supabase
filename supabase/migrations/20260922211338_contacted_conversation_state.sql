-- Forward-only. Existing contacted_leads RLS stays in force; server routes scope
-- organization and owner explicitly. No new public grants or policies.
alter table public.contacted_leads
  add column if not exists reply_sync_attempted_at timestamptz,
  add column if not exists reply_sync_succeeded_at timestamptz,
  add column if not exists reply_sync_error text,
  add column if not exists conversation_resolved_at timestamptz,
  add column if not exists conversation_outbound_at timestamptz;

create index if not exists contacted_reply_sync_queue_idx
  on public.contacted_leads (reply_sync_attempted_at asc nulls first, id)
  where provider in ('gmail', 'outlook') and sent_at is not null;
