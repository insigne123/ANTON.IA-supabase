-- Restore the Native Draft tables and column skipped by the original workspace migration.
-- This is intentionally additive because the original migration is already recorded remotely.

create extension if not exists pgcrypto;

create table if not exists public.email_style_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  profile jsonb not null default '{}'::jsonb,
  content_hash text not null,
  revision integer not null default 1,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_style_profiles_name_check check (length(trim(name)) between 1 and 120),
  constraint email_style_profiles_profile_check check (jsonb_typeof(profile) = 'object'),
  constraint email_style_profiles_hash_check check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint email_style_profiles_revision_check check (revision >= 1),
  unique (organization_id, name),
  unique (id, organization_id, user_id)
);

alter table public.messaging_draft_generation_metadata
  add column if not exists style_profile_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    join pg_attribute attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
      and attribute_row.attnum = any(constraint_row.conkey)
    where constraint_row.conrelid = 'public.messaging_draft_generation_metadata'::regclass
      and constraint_row.contype = 'f'
      and attribute_row.attname = 'style_profile_id'
  ) then
    alter table public.messaging_draft_generation_metadata
      add constraint messaging_draft_generation_metadata_style_profile_id_fkey
      foreign key (style_profile_id)
      references public.email_style_profiles(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists email_style_profiles_scope_updated_idx
  on public.email_style_profiles(organization_id, user_id, updated_at desc);

alter table public.email_style_profiles enable row level security;

revoke all on table public.email_style_profiles from anon;
grant select, insert, update on table public.email_style_profiles to authenticated;
grant all on table public.email_style_profiles to service_role;

drop policy if exists "Authenticated members can read email styles" on public.email_style_profiles;
drop policy if exists "Authenticated owners can create email styles" on public.email_style_profiles;
drop policy if exists "Authenticated owners can update email styles" on public.email_style_profiles;
drop policy if exists "Authenticated owners can delete email styles" on public.email_style_profiles;

create policy "Authenticated members can read email styles"
  on public.email_style_profiles for select to authenticated
  using (
    organization_id in (
      select organization_members.organization_id
      from public.organization_members
      where organization_members.user_id = (select auth.uid())
    )
  );

create policy "Authenticated owners can create email styles"
  on public.email_style_profiles for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and organization_id in (
      select organization_members.organization_id
      from public.organization_members
      where organization_members.user_id = (select auth.uid())
    )
  );

create policy "Authenticated owners can update email styles"
  on public.email_style_profiles for update to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (
      select organization_members.organization_id
      from public.organization_members
      where organization_members.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and organization_id in (
      select organization_members.organization_id
      from public.organization_members
      where organization_members.user_id = (select auth.uid())
    )
  );

create policy "Authenticated owners can delete email styles"
  on public.email_style_profiles for delete to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (
      select organization_members.organization_id
      from public.organization_members
      where organization_members.user_id = (select auth.uid())
    )
  );

notify pgrst, 'reload schema';
