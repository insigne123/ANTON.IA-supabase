alter table public.contacted_leads
  add column if not exists thread_key text,
  add column if not exists lifecycle_state text default 'sent',
  add column if not exists last_event_type text,
  add column if not exists last_event_at timestamptz,
  add column if not exists preflight_status text,
  add column if not exists preflight_reason text;

create index if not exists contacted_leads_thread_key_idx
  on public.contacted_leads(thread_key);

create index if not exists contacted_leads_lifecycle_state_idx
  on public.contacted_leads(lifecycle_state);

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  mission_id uuid,
  contacted_id text references public.contacted_leads(id) on delete cascade,
  lead_id text,
  provider text,
  event_type text not null,
  event_source text,
  event_at timestamptz not null default now(),
  thread_key text,
  message_id text,
  internet_message_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_events_contacted_id_idx
  on public.email_events(contacted_id, event_at desc);

create index if not exists email_events_org_event_at_idx
  on public.email_events(organization_id, event_at desc);

create index if not exists email_events_thread_key_idx
  on public.email_events(thread_key);

alter table public.email_events enable row level security;

drop policy if exists "Users can view email events for their orgs" on public.email_events;
create policy "Users can view email events for their orgs"
  on public.email_events
  for select
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = email_events.organization_id
        and om.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert email events for their orgs" on public.email_events;
create policy "Users can insert email events for their orgs"
  on public.email_events
  for insert
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = email_events.organization_id
        and om.user_id = auth.uid()
    )
  );
