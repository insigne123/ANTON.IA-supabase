create table if not exists public.organization_contact_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null,
  recipient_key text not null,
  recipient_email text,
  status text not null default 'available',
  active_lead_id uuid references public.leads(id) on delete set null,
  active_campaign_id text,
  opened_by_user_id uuid references auth.users(id) on delete set null,
  last_sent_by_user_id uuid references auth.users(id) on delete set null,
  root_dispatch_id uuid,
  reserved_dispatch_id uuid,
  reservation_expires_at timestamptz,
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  closed_at timestamptz,
  reopened_at timestamptz,
  reopened_by_user_id uuid references auth.users(id) on delete set null,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_contact_threads_channel_check check (channel in ('email', 'linkedin')),
  constraint organization_contact_threads_recipient_key_check check (length(trim(recipient_key)) between 3 and 500),
  constraint organization_contact_threads_status_check check (status in ('available', 'reserved', 'active', 'closed', 'suppressed')),
  constraint organization_contact_threads_email_check check (
    channel <> 'email' or (
      recipient_email is not null
      and recipient_email = lower(trim(recipient_email))
      and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and recipient_key = recipient_email
    )
  ),
  constraint organization_contact_threads_reservation_check check (
    (reserved_dispatch_id is null and reservation_expires_at is null)
    or (reserved_dispatch_id is not null and reservation_expires_at is not null)
  ),
  constraint organization_contact_threads_reopen_check check (
    (reopened_at is null and reopened_by_user_id is null and reopen_reason is null)
    or (reopened_at is not null and reopened_by_user_id is not null and length(trim(reopen_reason)) between 3 and 1000)
  ),
  unique (organization_id, channel, recipient_key)
);

create index if not exists organization_contact_threads_org_status_idx
  on public.organization_contact_threads(organization_id, status, last_contacted_at desc);
create index if not exists organization_contact_threads_reserved_idx
  on public.organization_contact_threads(reservation_expires_at)
  where reserved_dispatch_id is not null;

alter table public.outbound_dispatches
  add column if not exists contact_thread_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'outbound_dispatches_contact_thread_fkey'
      and conrelid = 'public.outbound_dispatches'::regclass
  ) then
    alter table public.outbound_dispatches
      add constraint outbound_dispatches_contact_thread_fkey
      foreign key (contact_thread_id) references public.organization_contact_threads(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_contact_threads_root_dispatch_fkey'
      and conrelid = 'public.organization_contact_threads'::regclass
  ) then
    alter table public.organization_contact_threads
      add constraint organization_contact_threads_root_dispatch_fkey
      foreign key (root_dispatch_id) references public.outbound_dispatches(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_contact_threads_reserved_dispatch_fkey'
      and conrelid = 'public.organization_contact_threads'::regclass
  ) then
    alter table public.organization_contact_threads
      add constraint organization_contact_threads_reserved_dispatch_fkey
      foreign key (reserved_dispatch_id) references public.outbound_dispatches(id) on delete set null;
  end if;
end;
$$;

alter table public.organization_collaboration_events
  drop constraint if exists organization_collaboration_events_contact_thread_fkey;
alter table public.organization_collaboration_events
  add constraint organization_collaboration_events_contact_thread_fkey
  foreign key (contact_thread_id) references public.organization_contact_threads(id) on delete set null;

alter table public.organization_contact_threads enable row level security;
drop policy if exists "Members can view contact threads v1"
  on public.organization_contact_threads;
create policy "Members can view contact threads v1"
  on public.organization_contact_threads for select to authenticated
  using (public.organization_has_role_v1(organization_id));

revoke all on table public.organization_contact_threads from public, anon, authenticated;
grant select on table public.organization_contact_threads to authenticated;
grant all on table public.organization_contact_threads to service_role;

notify pgrst, 'reload schema';
