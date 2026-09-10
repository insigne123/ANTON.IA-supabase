-- REVIEW ONLY: deploy before the library API. No brand templates are seeded.
begin;
alter table public.email_style_profiles
  add column library_scope text not null default 'personal',
  add column archived_at timestamptz,
  add column source_collection text,
  add column published_by uuid references auth.users(id) on delete set null,
  add column published_at timestamptz,
  add constraint email_style_library_scope_check check (library_scope in ('personal', 'team')),
  add constraint email_style_collection_check check (source_collection is null or source_collection = 'grupoexpro'),
  add constraint email_style_archived_default_check check (archived_at is null or not is_default);
alter table public.email_style_profiles drop constraint email_style_profiles_organization_id_name_key;
-- Fail atomically if historical case/whitespace variants collide; do not rename user data.
create unique index email_style_personal_name_uq
  on public.email_style_profiles(organization_id, user_id, lower(btrim(name)))
  where library_scope = 'personal' and archived_at is null;
create unique index email_style_team_name_uq
  on public.email_style_profiles(organization_id, lower(btrim(name)))
  where library_scope = 'team' and archived_at is null;
-- Legacy API could leave multiple defaults. Keep the most recently updated one.
with ranked as (
  select id, row_number() over (partition by organization_id, user_id order by updated_at desc, id) as position
  from public.email_style_profiles where is_default
)
update public.email_style_profiles set is_default = false, revision = revision + 1, updated_at = now()
where id in (select id from ranked where position > 1);
create unique index email_style_personal_default_uq
  on public.email_style_profiles(organization_id, user_id)
  where library_scope = 'personal' and is_default and archived_at is null;
create unique index email_style_team_default_uq
  on public.email_style_profiles(organization_id)
  where library_scope = 'team' and is_default and archived_at is null;
create index email_style_team_updated_idx on public.email_style_profiles(organization_id, updated_at desc)
  where library_scope = 'team' and archived_at is null;

alter table public.email_style_profiles enable row level security;
revoke all on public.email_style_profiles from anon;
drop policy if exists "Authenticated members can read email styles" on public.email_style_profiles;
drop policy if exists "Authenticated owners can create email styles" on public.email_style_profiles;
drop policy if exists "Authenticated owners can update email styles" on public.email_style_profiles;
drop policy if exists "Authenticated owners can delete email styles" on public.email_style_profiles;
create policy email_template_read on public.email_style_profiles for select to authenticated
  using (public.organization_has_role_v1(organization_id) and (library_scope = 'team' or user_id = (select auth.uid())));
create policy email_template_insert on public.email_style_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and public.organization_has_role_v1(organization_id)
    and (library_scope = 'personal' or public.organization_has_role_v1(organization_id, array['owner', 'admin'])));
create policy email_template_update on public.email_style_profiles for update to authenticated
  using (public.organization_has_role_v1(organization_id) and (
    (library_scope = 'personal' and user_id = (select auth.uid())) or
    (library_scope = 'team' and public.organization_has_role_v1(organization_id, array['owner', 'admin']))))
  with check (public.organization_has_role_v1(organization_id) and (
    (library_scope = 'personal' and user_id = (select auth.uid())) or
    (library_scope = 'team' and public.organization_has_role_v1(organization_id, array['owner', 'admin']))));
revoke delete on public.email_style_profiles from authenticated;

create function public.email_template_guard_v1() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if (new.organization_id, new.user_id, new.library_scope, new.source_collection)
      is distinct from (old.organization_id, old.user_id, old.library_scope, old.source_collection) then
      raise exception 'EMAIL_STYLE_FORBIDDEN';
    end if;
    if new.revision <> old.revision + 1 then raise exception 'EMAIL_STYLE_REVISION_CONFLICT'; end if;
  elsif new.revision <> 1 then
    raise exception 'EMAIL_STYLE_REVISION_CONFLICT';
  end if;
  new.updated_at := now();
  if new.library_scope = 'team' then
    new.published_by := auth.uid();
    new.published_at := now();
  else
    new.published_by := null;
    new.published_at := null;
  end if;
  return new;
end $$;
create trigger email_template_guard before insert or update on public.email_style_profiles
  for each row execute function public.email_template_guard_v1();

-- Invoker rights preserve RLS. Advisory lock serializes defaults across API instances.
create function public.mutate_email_template_v1(
  p_organization_id uuid, p_action text, p_id uuid, p_expected_revision integer,
  p_name text, p_profile jsonb, p_content_hash text, p_library_scope text,
  p_is_default boolean, p_publish_confirmed boolean, p_source_collection text
) returns public.email_style_profiles
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_row public.email_style_profiles;
  v_source public.email_style_profiles;
begin
  if auth.uid() is null or not public.organization_has_role_v1(p_organization_id) then
    raise exception 'EMAIL_STYLE_FORBIDDEN';
  end if;
  if p_action not in ('save', 'duplicate', 'archive') or p_action is null
    or p_library_scope is null or p_library_scope not in ('personal', 'team')
    or p_is_default is null then raise exception 'EMAIL_STYLE_INVALID_REQUEST'; end if;
  if p_library_scope = 'team' and (not public.organization_has_role_v1(p_organization_id, array['owner', 'admin'])
    or p_publish_confirmed is distinct from true) then raise exception 'EMAIL_STYLE_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' ||
    case when p_library_scope = 'team' then 'team' else auth.uid()::text end, 0));
  if p_id is not null then
    if p_action = 'duplicate' then
      -- Read permission is enough to copy a team template into a member's personal library.
      select * into v_source from public.email_style_profiles
        where id = p_id and organization_id = p_organization_id and archived_at is null;
    else
      select * into v_source from public.email_style_profiles
        where id = p_id and organization_id = p_organization_id and archived_at is null for update;
    end if;
    if not found then raise exception 'EMAIL_STYLE_NOT_FOUND'; end if;
    if p_expected_revision is null or p_expected_revision <> v_source.revision then
      raise exception 'EMAIL_STYLE_REVISION_CONFLICT';
    end if;
    if p_action <> 'duplicate' and (p_library_scope <> v_source.library_scope or
      (v_source.library_scope = 'personal' and v_source.user_id <> auth.uid())) then
      raise exception 'EMAIL_STYLE_FORBIDDEN';
    end if;
  elsif p_action <> 'save' or p_expected_revision is not null then
    raise exception 'EMAIL_STYLE_INVALID_REQUEST';
  end if;
  if p_action = 'archive' then
    update public.email_style_profiles set archived_at = now(), is_default = false, revision = revision + 1
      where id = p_id returning * into v_row;
  else
    if p_is_default then
      update public.email_style_profiles set is_default = false, revision = revision + 1
        where organization_id = p_organization_id and library_scope = p_library_scope
          and (p_library_scope = 'team' or user_id = auth.uid()) and is_default
          and (p_action = 'duplicate' or id is distinct from p_id);
    end if;
    if p_action = 'save' and p_id is not null then
      update public.email_style_profiles set name = btrim(p_name), profile = p_profile,
        content_hash = p_content_hash, is_default = p_is_default, revision = revision + 1
        where id = p_id returning * into v_row;
    else
      insert into public.email_style_profiles(organization_id, user_id, name, profile, content_hash,
        library_scope, is_default, source_collection)
      values (p_organization_id, auth.uid(), btrim(p_name),
        case when p_action = 'duplicate' then v_source.profile else p_profile end,
        case when p_action = 'duplicate' then v_source.content_hash else p_content_hash end,
        p_library_scope, p_is_default,
        case when p_action = 'duplicate' then v_source.source_collection else p_source_collection end)
      returning * into v_row;
    end if;
  end if;
  if v_row.id is null then raise exception 'EMAIL_STYLE_FORBIDDEN'; end if;
  return v_row;
end $$;
revoke all on function public.mutate_email_template_v1(uuid,text,uuid,integer,text,jsonb,text,text,boolean,boolean,text) from public, anon;
grant execute on function public.mutate_email_template_v1(uuid,text,uuid,integer,text,jsonb,text,text,boolean,boolean,text) to authenticated;
notify pgrst, 'reload schema';
commit;
