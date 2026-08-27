create table if not exists public.organization_lead_collaboration (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  discovered_by_user_id uuid references auth.users(id) on delete set null,
  discovered_at timestamptz not null default now(),
  assigned_to_user_id uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  assigned_by_user_id uuid references auth.users(id) on delete set null,
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  claim_expires_at timestamptz,
  contact_state text not null default 'uncontacted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_lead_collaboration_contact_state_check check (
    contact_state in ('uncontacted', 'reserved', 'contacted', 'replied', 'suppressed')
  ),
  constraint organization_lead_collaboration_assignment_check check (
    (assigned_to_user_id is null and assigned_at is null)
    or (assigned_to_user_id is not null and assigned_at is not null)
  ),
  constraint organization_lead_collaboration_claim_check check (
    (claimed_by_user_id is null and claim_expires_at is null)
    or (claimed_by_user_id is not null and claim_expires_at is not null)
  )
);

create index if not exists organization_lead_collaboration_org_assignee_idx
  on public.organization_lead_collaboration(organization_id, assigned_to_user_id, updated_at desc);
create index if not exists organization_lead_collaboration_active_claim_idx
  on public.organization_lead_collaboration(organization_id, claim_expires_at)
  where claimed_by_user_id is not null;

create or replace function public.ensure_organization_lead_collaboration_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_discovered_by uuid;
begin
  if new.organization_id is null then return new; end if;

  select new.user_id into v_discovered_by
  where exists (
    select 1 from public.organization_members om
    where om.organization_id = new.organization_id and om.user_id = new.user_id
  );

  insert into public.organization_lead_collaboration (
    lead_id, organization_id, discovered_by_user_id, discovered_at
  ) values (
    new.id, new.organization_id, v_discovered_by, coalesce(new.created_at, now())
  ) on conflict (lead_id) do nothing;

  if tg_op = 'INSERT' then
    perform public.append_organization_collaboration_event_v1(
      new.organization_id, v_discovered_by, 'lead.discovered', 'lead', new.id::text,
      new.id, null, '{}'::jsonb
    );
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_organization_lead_collaboration on public.leads;
create trigger ensure_organization_lead_collaboration
  after insert or update of organization_id on public.leads
  for each row execute function public.ensure_organization_lead_collaboration_v1();

-- Historical user attribution is retained only when that user is still a
-- member of the row organization. Organization and discovery time remain.
insert into public.organization_lead_collaboration (
  lead_id, organization_id, discovered_by_user_id, discovered_at
)
select
  l.id,
  l.organization_id,
  case when exists (
    select 1 from public.organization_members om
    where om.organization_id = l.organization_id and om.user_id = l.user_id
  ) then l.user_id else null end,
  coalesce(l.created_at, now())
from public.leads l
where l.organization_id is not null
on conflict (lead_id) do nothing;

create or replace function public.guard_organization_lead_collaboration_identity_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.lead_id is distinct from old.lead_id
    or new.organization_id is distinct from old.organization_id
    or new.discovered_by_user_id is distinct from old.discovered_by_user_id
    or new.discovered_at is distinct from old.discovered_at
    or new.created_at is distinct from old.created_at then
    raise exception 'lead collaboration provenance is immutable' using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guard_organization_lead_collaboration_identity on public.organization_lead_collaboration;
create trigger guard_organization_lead_collaboration_identity
  before update on public.organization_lead_collaboration
  for each row execute function public.guard_organization_lead_collaboration_identity_v1();

create or replace function public.assign_organization_lead_v1(
  p_lead_id uuid,
  p_assigned_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.organization_lead_collaboration%rowtype;
  v_actor_role text;
begin
  if auth.uid() is null or p_lead_id is null or p_assigned_to_user_id is null then
    raise exception 'invalid lead assignment' using errcode = '22023';
  end if;

  select * into v_row
  from public.organization_lead_collaboration
  where lead_id = p_lead_id
  for update;
  if not found then raise exception 'Lead collaboration row not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = v_row.organization_id and o.collaboration_v1_enabled
  ) then
    raise exception 'Organization collaboration is not enabled' using errcode = '55000';
  end if;

  select om.role into v_actor_role
  from public.organization_members om
  where om.organization_id = v_row.organization_id and om.user_id = auth.uid();
  if v_actor_role is null then raise exception 'not authorized' using errcode = '42501'; end if;

  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = v_row.organization_id and om.user_id = p_assigned_to_user_id
  ) then
    raise exception 'Assignee is not an organization member' using errcode = '22023';
  end if;

  if v_actor_role = 'member' and (
    p_assigned_to_user_id <> auth.uid()
    or (v_row.assigned_to_user_id is not null and v_row.assigned_to_user_id <> auth.uid())
  ) then
    raise exception 'Members can only claim an unassigned lead for themselves' using errcode = '42501';
  end if;

  update public.organization_lead_collaboration
  set assigned_to_user_id = p_assigned_to_user_id,
      assigned_at = now(),
      assigned_by_user_id = auth.uid(),
      claimed_by_user_id = case
        when claimed_by_user_id is not null and claimed_by_user_id is distinct from p_assigned_to_user_id then null
        else claimed_by_user_id
      end,
      claim_expires_at = case
        when claimed_by_user_id is not null and claimed_by_user_id is distinct from p_assigned_to_user_id then null
        else claim_expires_at
      end,
      contact_state = case
        when claimed_by_user_id is not null
          and claimed_by_user_id is distinct from p_assigned_to_user_id
          and contact_state = 'reserved' then 'uncontacted'
        else contact_state
      end
  where lead_id = p_lead_id
  returning * into v_row;

  perform public.append_organization_collaboration_event_v1(
    v_row.organization_id, auth.uid(), 'lead.assigned', 'lead', p_lead_id::text,
    p_lead_id, null, jsonb_build_object('assignedToUserId', p_assigned_to_user_id)
  );
  return to_jsonb(v_row);
end;
$$;

create or replace function public.claim_organization_lead_v1(
  p_lead_id uuid,
  p_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.organization_lead_collaboration%rowtype;
  v_actor_role text;
begin
  if auth.uid() is null or p_lead_id is null or p_minutes not between 1 and 60 then
    raise exception 'invalid lead claim' using errcode = '22023';
  end if;

  select * into v_row
  from public.organization_lead_collaboration
  where lead_id = p_lead_id
  for update;
  if not found then raise exception 'Lead collaboration row not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = v_row.organization_id and o.collaboration_v1_enabled
  ) then
    raise exception 'Organization collaboration is not enabled' using errcode = '55000';
  end if;

  select om.role into v_actor_role
  from public.organization_members om
  where om.organization_id = v_row.organization_id and om.user_id = auth.uid();
  if v_actor_role is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_row.claimed_by_user_id is not null
    and v_row.claimed_by_user_id <> auth.uid()
    and v_row.claim_expires_at > now() then
    raise exception 'Lead is already being prepared by another member' using errcode = '55000';
  end if;
  if v_actor_role = 'member' and v_row.assigned_to_user_id is not null
    and v_row.assigned_to_user_id <> auth.uid() then
    raise exception 'Lead is assigned to another member' using errcode = '42501';
  end if;

  update public.organization_lead_collaboration
  set assigned_to_user_id = coalesce(assigned_to_user_id, auth.uid()),
      assigned_at = case when assigned_to_user_id is null then now() else assigned_at end,
      assigned_by_user_id = case when assigned_to_user_id is null then auth.uid() else assigned_by_user_id end,
      claimed_by_user_id = auth.uid(),
      claim_expires_at = now() + make_interval(mins => p_minutes),
      contact_state = case when contact_state = 'uncontacted' then 'reserved' else contact_state end
  where lead_id = p_lead_id
  returning * into v_row;

  perform public.append_organization_collaboration_event_v1(
    v_row.organization_id, auth.uid(), 'lead.claimed', 'lead', p_lead_id::text,
    p_lead_id, null, jsonb_build_object('expiresAt', v_row.claim_expires_at)
  );
  return to_jsonb(v_row);
end;
$$;

create or replace function public.release_organization_lead_claim_v1(p_lead_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.organization_lead_collaboration%rowtype;
  v_role text;
begin
  select * into v_row
  from public.organization_lead_collaboration
  where lead_id = p_lead_id
  for update;
  if not found then return false; end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = v_row.organization_id and o.collaboration_v1_enabled
  ) then
    raise exception 'Organization collaboration is not enabled' using errcode = '55000';
  end if;

  select om.role into v_role from public.organization_members om
  where om.organization_id = v_row.organization_id and om.user_id = auth.uid();
  if v_role is null or (
    v_row.claimed_by_user_id is distinct from auth.uid() and v_role not in ('owner', 'admin')
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.organization_lead_collaboration
  set claimed_by_user_id = null,
      claim_expires_at = null,
      contact_state = case when contact_state = 'reserved' then 'uncontacted' else contact_state end
  where lead_id = p_lead_id;
  perform public.append_organization_collaboration_event_v1(
    v_row.organization_id, auth.uid(), 'lead.claim_released', 'lead', p_lead_id::text,
    p_lead_id, null, '{}'::jsonb
  );
  return true;
end;
$$;

revoke all on function public.assign_organization_lead_v1(uuid, uuid) from public, anon;
revoke all on function public.claim_organization_lead_v1(uuid, integer) from public, anon;
revoke all on function public.release_organization_lead_claim_v1(uuid) from public, anon;
grant execute on function public.assign_organization_lead_v1(uuid, uuid) to authenticated, service_role;
grant execute on function public.claim_organization_lead_v1(uuid, integer) to authenticated, service_role;
grant execute on function public.release_organization_lead_claim_v1(uuid) to authenticated, service_role;

alter table public.organization_lead_collaboration enable row level security;
drop policy if exists "Members can view lead collaboration v1"
  on public.organization_lead_collaboration;
create policy "Members can view lead collaboration v1"
  on public.organization_lead_collaboration for select to authenticated
  using (public.organization_has_role_v1(organization_id));

revoke all on table public.organization_lead_collaboration from public, anon, authenticated;
grant select on table public.organization_lead_collaboration to authenticated;
grant all on table public.organization_lead_collaboration to service_role;

notify pgrst, 'reload schema';
