-- search_queue is a legacy table (last row 2025-11-26, no code reads or writes it) that never had row level security:
-- with the public anon key anyone could read and insert company domains and search filters. Turning RLS on without
-- policies closes it to anon and authenticated; the service role still bypasses RLS, so nothing server-side changes.
alter table public.search_queue enable row level security;
revoke all on table public.search_queue from anon, authenticated;
