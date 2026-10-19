-- «Para retomar» (propuesta 7, 19 oct 2026).
-- 1. How a conversation was closed, next to when (conversation_resolved_at): «Sin acuerdo» and «Lo retomo yo» come back
--    after a while, «No interesado» and «Ganado» never. Null for the conversations closed before this column.
-- 2. What the person did with an alert: postponed until a date or «No retomar» for good. Server only (service role), like
--    the rest of the conversation work; every route scopes organization and owner explicitly.
alter table public.contacted_leads add column if not exists conversation_close_outcome text;
alter table public.contacted_leads drop constraint if exists contacted_leads_close_outcome_check;
alter table public.contacted_leads add constraint contacted_leads_close_outcome_check
  check (conversation_close_outcome is null or conversation_close_outcome in ('no_deal', 'won', 'not_interested', 'keep'));

create table if not exists public.contact_reconnect_marks (
  user_id uuid not null references auth.users(id) on delete cascade,
  contacted_id text not null references public.contacted_leads(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  state text not null check (state in ('snoozed', 'dismissed')),
  until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, contacted_id),
  constraint contact_reconnect_marks_until_check check ((state = 'snoozed') = (until is not null))
);
create index if not exists contact_reconnect_marks_org_user_idx on public.contact_reconnect_marks (organization_id, user_id);
alter table public.contact_reconnect_marks enable row level security;
revoke all on public.contact_reconnect_marks from public, anon, authenticated;
grant all on public.contact_reconnect_marks to service_role;
