-- The organization's mailbox reaches a member who also has an organization of their own. Every account is created with
-- one (handle_new_user), so «belongs to no other organization» left out anyone who joined by invitation. What must not
-- happen is the team's mailbox writing for another team: only an organization the person shares with someone else
-- counts as another one. A mailbox the person connected for themselves is still never replaced.
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
          and exists (
            select 1 from public.organization_members peer
            where peer.organization_id = other.organization_id and peer.user_id <> m.user_id
          )
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
      and exists (
        select 1 from public.organization_members peer
        where peer.organization_id = other.organization_id and peer.user_id <> new.user_id
      )
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
