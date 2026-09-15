-- Applied to production via MCP; version aligned with migration ledger.
-- Private Cowork foundation. Access remains closed until a trusted operator
-- provisions the verified owner's UUID in cowork_access_grants.
create table public.cowork_access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false
);
alter table public.cowork_access_grants enable row level security;
revoke all on public.cowork_access_grants from anon, authenticated;
grant all on public.cowork_access_grants to service_role;

create function public.cowork_has_access(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cowork_access_grants g
    join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id
    where g.user_id = auth.uid() and g.enabled
      and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl'
      and u.email_confirmed_at is not null
      and m.organization_id = target_organization_id
  );
$$;
revoke all on function public.cowork_has_access(uuid) from public, anon;
grant execute on function public.cowork_has_access(uuid) to authenticated;

create table public.cowork_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  organization_id uuid not null references public.organizations(id),
  request_id uuid not null,
  message text not null check (length(trim(message)) between 1 and 20000),
  mode text not null check (mode in ('approval', 'autonomous')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, organization_id, request_id),
  unique (id, user_id, organization_id)
);
create index cowork_runs_scope_created on public.cowork_runs(user_id, organization_id, created_at desc);
alter table public.cowork_runs enable row level security;
revoke all on public.cowork_runs from anon, authenticated;
grant select on public.cowork_runs to authenticated;
grant all on public.cowork_runs to service_role;
create policy cowork_runs_private_read on public.cowork_runs for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));

create table public.cowork_run_events (
  sequence bigint generated always as identity primary key,
  run_id uuid not null,
  user_id uuid not null,
  organization_id uuid not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (run_id, user_id, organization_id)
    references public.cowork_runs(id, user_id, organization_id) on delete cascade
);
create index cowork_events_run_sequence on public.cowork_run_events(run_id, sequence);
alter table public.cowork_run_events enable row level security;
revoke all on public.cowork_run_events from anon, authenticated;
grant select on public.cowork_run_events to authenticated;
grant all on public.cowork_run_events to service_role;
grant usage, select on sequence public.cowork_run_events_sequence_seq to service_role;
create policy cowork_events_private_read on public.cowork_run_events for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));

-- Initial event and admission are one transaction, including under retries.
create function public.cowork_admit_run(
  p_user_id uuid, p_organization_id uuid, p_request_id uuid, p_message text, p_mode text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid;
begin
  if not exists (
    select 1 from public.cowork_access_grants g
    join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id
    where g.user_id = p_user_id and g.enabled
      and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl'
      and u.email_confirmed_at is not null and m.organization_id = p_organization_id
  ) then raise exception 'Cowork access denied' using errcode = '42501'; end if;

  insert into public.cowork_runs(user_id, organization_id, request_id, message, mode)
    values (p_user_id, p_organization_id, p_request_id, p_message, p_mode)
    on conflict (user_id, organization_id, request_id) do nothing returning id into result_id;
  if result_id is not null then
    insert into public.cowork_run_events(run_id, user_id, organization_id, kind)
      values (result_id, p_user_id, p_organization_id, 'work.created');
  else
    select id into result_id from public.cowork_runs
      where user_id = p_user_id and organization_id = p_organization_id
        and request_id = p_request_id and message = p_message and mode = p_mode;
    if result_id is null then raise exception 'Idempotency conflict' using errcode = '22023'; end if;
  end if;
  return result_id;
end;
$$;
revoke all on function public.cowork_admit_run(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.cowork_admit_run(uuid, uuid, uuid, text, text) to service_role;
