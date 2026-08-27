-- Membership and invitation mutations are server-owned RPCs. Direct table DML
-- is removed so clients cannot forge roles or membership rows.
create or replace function public.create_organization_invite_v1(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_invite public.organization_invites%rowtype;
begin
  if not public.organization_has_role_v1(p_organization_id, array['owner', 'admin']) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_role not in ('admin', 'member')
    or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid invitation' using errcode = '22023';
  end if;
  if exists (
    select 1 from auth.users u
    join public.organization_members om on om.user_id = u.id
    where om.organization_id = p_organization_id and lower(trim(u.email)) = v_email
  ) then
    raise exception 'This person is already a member' using errcode = '23505';
  end if;

  update public.organization_invites
  set revoked_at = now(), revoked_by = auth.uid()
  where organization_id = p_organization_id
    and lower(trim(email)) = v_email
    and accepted_at is null and revoked_at is null;

  insert into public.organization_invites (
    organization_id, email, role, token, token_hash, invited_by, expires_at
  ) values (
    p_organization_id, v_email, p_role, null, p_token_hash, auth.uid(), now() + interval '7 days'
  ) returning * into v_invite;

  perform public.append_organization_collaboration_event_v1(
    p_organization_id, auth.uid(), 'member.invited', 'organization_invite', v_invite.id::text,
    null, null, jsonb_build_object('role', p_role)
  );
  return jsonb_build_object(
    'id', v_invite.id,
    'email', v_invite.email,
    'role', v_invite.role,
    'expiresAt', v_invite.expires_at
  );
end;
$$;

create or replace function public.accept_organization_invite_v1(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.organization_invites%rowtype;
  v_user_email text;
begin
  if auth.uid() is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid invitation' using errcode = '22023';
  end if;

  select * into v_invite
  from public.organization_invites
  where token_hash = p_token_hash
  for update;
  if not found or v_invite.revoked_at is not null or v_invite.accepted_at is not null
    or v_invite.expires_at <= now() then
    raise exception 'Invitation is invalid or expired' using errcode = '55000';
  end if;

  select lower(trim(u.email)) into v_user_email from auth.users u where u.id = auth.uid();
  if v_user_email is distinct from lower(trim(v_invite.email)) then
    raise exception 'Invitation belongs to another email address' using errcode = '42501';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_invite.organization_id, auth.uid(), v_invite.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invites
  set accepted_at = now(), accepted_by = auth.uid()
  where id = v_invite.id;

  perform public.append_organization_collaboration_event_v1(
    v_invite.organization_id, auth.uid(), 'member.joined', 'organization_member', auth.uid()::text,
    null, null, jsonb_build_object('role', v_invite.role)
  );
  return v_invite.organization_id;
end;
$$;

create or replace function public.revoke_organization_invite_v1(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.organization_invites%rowtype;
begin
  select * into v_invite from public.organization_invites where id = p_invite_id for update;
  if not found then return false; end if;
  if not public.organization_has_role_v1(v_invite.organization_id, array['owner', 'admin']) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'Accepted invitations cannot be revoked' using errcode = '55000';
  end if;
  update public.organization_invites
  set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid())
  where id = p_invite_id;
  perform public.append_organization_collaboration_event_v1(
    v_invite.organization_id, auth.uid(), 'member.invite_revoked', 'organization_invite', p_invite_id::text
  );
  return true;
end;
$$;

create or replace function public.update_organization_member_role_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_role text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended(concat('organization-membership:', p_organization_id::text), 0));
  select role into v_actor_role from public.organization_members
  where organization_id = p_organization_id and user_id = auth.uid();
  select role into v_target_role from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id for update;
  if v_actor_role not in ('owner', 'admin') or v_target_role is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if v_actor_role = 'admin' and (v_target_role = 'owner' or p_role = 'owner') then
    raise exception 'Admins cannot manage owners' using errcode = '42501';
  end if;
  if v_target_role = 'owner' and p_role <> 'owner' and (
    select count(*) from public.organization_members
    where organization_id = p_organization_id and role = 'owner'
  ) <= 1 then
    raise exception 'Organization must keep at least one owner' using errcode = '55000';
  end if;

  update public.organization_members set role = p_role
  where organization_id = p_organization_id and user_id = p_user_id;
  perform public.append_organization_collaboration_event_v1(
    p_organization_id, auth.uid(), 'member.role_changed', 'organization_member', p_user_id::text,
    null, null, jsonb_build_object('previousRole', v_target_role, 'role', p_role)
  );
  return true;
end;
$$;

create or replace function public.remove_organization_member_v1(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended(concat('organization-membership:', p_organization_id::text), 0));
  if p_user_id = auth.uid() then
    raise exception 'Use leave organization for your own membership' using errcode = '22023';
  end if;
  select role into v_actor_role from public.organization_members
  where organization_id = p_organization_id and user_id = auth.uid();
  select role into v_target_role from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id for update;
  if v_actor_role not in ('owner', 'admin') or v_target_role is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_actor_role = 'admin' and v_target_role = 'owner' then
    raise exception 'Admins cannot remove owners' using errcode = '42501';
  end if;
  if v_target_role = 'owner' and (
    select count(*) from public.organization_members
    where organization_id = p_organization_id and role = 'owner'
  ) <= 1 then
    raise exception 'Organization must keep at least one owner' using errcode = '55000';
  end if;

  delete from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id;
  perform public.append_organization_collaboration_event_v1(
    p_organization_id, auth.uid(), 'member.removed', 'organization_member', p_user_id::text,
    null, null, jsonb_build_object('previousRole', v_target_role)
  );
  return true;
end;
$$;

create or replace function public.leave_organization_v1(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended(concat('organization-membership:', p_organization_id::text), 0));
  select role into v_role from public.organization_members
  where organization_id = p_organization_id and user_id = auth.uid() for update;
  if v_role is null then return false; end if;
  if v_role = 'owner' and (
    select count(*) from public.organization_members
    where organization_id = p_organization_id and role = 'owner'
  ) <= 1 then
    raise exception 'Transfer ownership before leaving' using errcode = '55000';
  end if;
  delete from public.organization_members
  where organization_id = p_organization_id and user_id = auth.uid();
  perform public.append_organization_collaboration_event_v1(
    p_organization_id, auth.uid(), 'member.left', 'organization_member', auth.uid()::text,
    null, null, jsonb_build_object('previousRole', v_role)
  );
  return true;
end;
$$;

revoke all on function public.create_organization_invite_v1(uuid, text, text, text) from public, anon;
revoke all on function public.accept_organization_invite_v1(text) from public, anon;
revoke all on function public.revoke_organization_invite_v1(uuid) from public, anon;
revoke all on function public.update_organization_member_role_v1(uuid, uuid, text) from public, anon;
revoke all on function public.remove_organization_member_v1(uuid, uuid) from public, anon;
revoke all on function public.leave_organization_v1(uuid) from public, anon;
grant execute on function public.create_organization_invite_v1(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.accept_organization_invite_v1(text) to authenticated, service_role;
grant execute on function public.revoke_organization_invite_v1(uuid) to authenticated, service_role;
grant execute on function public.update_organization_member_role_v1(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.remove_organization_member_v1(uuid, uuid) to authenticated, service_role;
grant execute on function public.leave_organization_v1(uuid) to authenticated, service_role;

-- Collaboration-enabled organizations retain organization-owned records after
-- membership removal. Existing non-collaboration behavior remains unchanged.
create or replace function public.unlink_member_owned_records_from_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_collaboration_enabled boolean := false;
begin
  select coalesce(o.collaboration_v1_enabled, false) into v_collaboration_enabled
  from public.organizations o where o.id = old.organization_id;
  if v_collaboration_enabled then return old; end if;

  update public.leads set organization_id = null
  where organization_id = old.organization_id and user_id = old.user_id;
  update public.enriched_leads set organization_id = null
  where organization_id = old.organization_id and user_id = old.user_id;
  update public.contacted_leads set organization_id = null
  where organization_id = old.organization_id and user_id = old.user_id;
  update public.campaigns set organization_id = null
  where organization_id = old.organization_id and user_id = old.user_id;
  return old;
end;
$$;

-- The legacy plaintext-token acceptor cannot consume V1 hashed invitations.
revoke all on function public.accept_invite(text) from public, anon, authenticated;

do $$
declare
  p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'organization_members'
  loop execute format('drop policy if exists %I on public.organization_members', p.policyname); end loop;
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'organization_invites'
  loop execute format('drop policy if exists %I on public.organization_invites', p.policyname); end loop;
end;
$$;

create policy "Members can view organization memberships v1"
  on public.organization_members for select to authenticated
  using (organization_id in (select public.get_my_org_ids()));
create policy "Admins can view organization invitations v1"
  on public.organization_invites for select to authenticated
  using (public.organization_has_role_v1(organization_id, array['owner', 'admin']));

revoke all on table public.organization_members from public, anon, authenticated;
revoke all on table public.organization_invites from public, anon, authenticated;
grant select on table public.organization_members to authenticated;
grant select on table public.organization_invites to authenticated;
grant all on table public.organization_members to service_role;
grant all on table public.organization_invites to service_role;

notify pgrst, 'reload schema';
