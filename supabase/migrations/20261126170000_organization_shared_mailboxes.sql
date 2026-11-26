-- One mailbox for a whole organization. A team that writes from a single address (contacto@…) connects it once: the
-- person who signs in with that mailbox shares the connection with everyone in the organization, and whoever joins later
-- gets it too. Mailbox connections stay one row per person (provider_tokens): every reader keeps working as it did, and
-- the shared ones are marked with the organization they come from. Only organizations listed here work this way.
create table if not exists public.organization_shared_mailboxes (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  -- The one mailbox that is shared: a personal mailbox connected by a member stays personal.
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id, provider)
);

create index if not exists organization_shared_mailboxes_connected_by_idx
  on public.organization_shared_mailboxes (connected_by) where connected_by is not null;

alter table public.organization_shared_mailboxes enable row level security;
-- Written by the ANTON.IA team and read by the server only: no client policy.
revoke all on table public.organization_shared_mailboxes from public, anon, authenticated;
grant select, insert, update, delete on table public.organization_shared_mailboxes to service_role;

-- The organization whose shared mailbox this connection is; null for a mailbox the person connected for themselves.
alter table public.provider_tokens
  add column if not exists shared_organization_id uuid references public.organizations(id) on delete cascade;

create index if not exists provider_tokens_shared_organization_idx
  on public.provider_tokens (shared_organization_id, provider) where shared_organization_id is not null;

-- After someone connected the organization's mailbox (the server checked the address first): marks their connection as
-- the shared one and gives it to the other members. Returns how many members got it.
--   - Only to someone who belongs to this organization alone: a connection is the person's in every organization they
--     are in, and the shared mailbox must not write for another company.
--   - Never over a mailbox a member connected for themselves.
create or replace function public.share_organization_mailbox_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_provider text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_token public.provider_tokens%rowtype;
  v_shared integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_shared_mailboxes s
    where s.organization_id = p_organization_id and s.provider = p_provider
  ) or not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_user_id
  ) then
    return 0;
  end if;

  update public.provider_tokens t
  set shared_organization_id = p_organization_id
  where t.user_id = p_user_id and t.provider = p_provider
  returning t.* into v_token;
  if not found then return 0; end if;

  update public.organization_shared_mailboxes s
  set connected_by = p_user_id, connected_at = now()
  where s.organization_id = p_organization_id and s.provider = p_provider;

  with eligible as (
    select m.user_id
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id <> p_user_id
      and not exists (
        select 1 from public.organization_members other
        where other.user_id = m.user_id and other.organization_id <> p_organization_id
      )
  ), written as (
    insert into public.provider_tokens (user_id, provider, refresh_token, expires_at, updated_at, shared_organization_id)
    select e.user_id, p_provider, v_token.refresh_token, v_token.expires_at, now(), p_organization_id
    from eligible e
    on conflict (user_id, provider) do update
      set refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, updated_at = excluded.updated_at
      where public.provider_tokens.shared_organization_id = p_organization_id
    returning 1
  )
  select count(*)::integer into v_shared from written;
  return v_shared;
end;
$$;

revoke all on function public.share_organization_mailbox_v1(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.share_organization_mailbox_v1(uuid, uuid, text) to service_role;

-- Someone joins an organization that shares a mailbox: they get the connection, under the same two rules. A failure here
-- never stops the person from joining.
create or replace function public.adopt_organization_shared_mailbox_f()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1 from public.organization_members other
    where other.user_id = new.user_id and other.organization_id <> new.organization_id
  ) then
    return new;
  end if;
  insert into public.provider_tokens (user_id, provider, refresh_token, expires_at, updated_at, shared_organization_id)
  select distinct on (t.provider) new.user_id, t.provider, t.refresh_token, t.expires_at, now(), t.shared_organization_id
  from public.provider_tokens t
  join public.organization_shared_mailboxes s
    on s.organization_id = t.shared_organization_id and s.provider = t.provider
  where t.shared_organization_id = new.organization_id and t.user_id <> new.user_id
  order by t.provider, t.updated_at desc nulls last
  on conflict (user_id, provider) do nothing;
  return new;
exception when others then
  raise warning 'adopt_organization_shared_mailbox_f: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.adopt_organization_shared_mailbox_f() from public, anon, authenticated;

create or replace trigger organization_members_adopt_shared_mailbox
  after insert on public.organization_members
  for each row execute function public.adopt_organization_shared_mailbox_f();

-- Someone leaves the organization: the shared mailbox stops being theirs. A mailbox they connected for themselves stays.
create or replace function public.drop_organization_shared_mailbox_f()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  delete from public.provider_tokens t
  where t.user_id = old.user_id and t.shared_organization_id = old.organization_id;
  return old;
exception when others then
  raise warning 'drop_organization_shared_mailbox_f: %', sqlerrm;
  return old;
end;
$$;

revoke all on function public.drop_organization_shared_mailbox_f() from public, anon, authenticated;

create or replace trigger organization_members_drop_shared_mailbox
  after delete on public.organization_members
  for each row execute function public.drop_organization_shared_mailbox_f();
