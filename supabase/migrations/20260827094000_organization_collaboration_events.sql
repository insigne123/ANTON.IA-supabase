create table if not exists public.organization_collaboration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  lead_id uuid references public.leads(id) on delete set null,
  contact_thread_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint organization_collaboration_events_type_check check (length(trim(event_type)) between 1 and 120),
  constraint organization_collaboration_events_entity_check check (length(trim(entity_type)) between 1 and 80),
  constraint organization_collaboration_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists organization_collaboration_events_org_created_idx
  on public.organization_collaboration_events(organization_id, created_at desc);
create index if not exists organization_collaboration_events_lead_created_idx
  on public.organization_collaboration_events(lead_id, created_at desc)
  where lead_id is not null;

create or replace function public.append_organization_collaboration_event_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id text default null,
  p_lead_id uuid default null,
  p_contact_thread_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_organization_id is null
    or length(trim(coalesce(p_event_type, ''))) not between 1 and 120
    or length(trim(coalesce(p_entity_type, ''))) not between 1 and 80
    or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid collaboration event' using errcode = '22023';
  end if;

  insert into public.organization_collaboration_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id,
    lead_id, contact_thread_id, metadata
  ) values (
    p_organization_id, p_actor_user_id, trim(p_event_type), trim(p_entity_type),
    nullif(trim(coalesce(p_entity_id, '')), ''), p_lead_id, p_contact_thread_id,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.append_organization_collaboration_event_v1(uuid, uuid, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.append_organization_collaboration_event_v1(uuid, uuid, text, text, text, uuid, uuid, jsonb) to service_role;

create or replace function public.block_organization_collaboration_event_mutation_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'organization collaboration events are append-only' using errcode = '55000';
end;
$$;

drop trigger if exists organization_collaboration_events_immutable on public.organization_collaboration_events;
create trigger organization_collaboration_events_immutable
  before update or delete on public.organization_collaboration_events
  for each row execute function public.block_organization_collaboration_event_mutation_v1();

alter table public.organization_collaboration_events enable row level security;
drop policy if exists "Members can view collaboration events v1"
  on public.organization_collaboration_events;
create policy "Members can view collaboration events v1"
  on public.organization_collaboration_events for select to authenticated
  using (public.organization_has_role_v1(organization_id));

revoke all on table public.organization_collaboration_events from public, anon, authenticated;
grant select on table public.organization_collaboration_events to authenticated;
grant select, insert on table public.organization_collaboration_events to service_role;

notify pgrst, 'reload schema';
