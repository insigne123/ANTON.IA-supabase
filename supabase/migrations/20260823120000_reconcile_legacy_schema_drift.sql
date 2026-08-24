-- Reconcile older production tables with the current privacy-aware contracts.
-- Keep this migration additive and safe to run after the earlier migrations.

do $$
begin
  if to_regclass('public.native_draft_generation_claims') is not null then
    alter table public.native_draft_generation_claims
      add column if not exists version_id uuid,
      add column if not exists identity_hash text,
      add column if not exists subject_email text,
      add column if not exists created_at timestamptz not null default now();

    alter table public.native_draft_generation_claims
      alter column version_id drop not null,
      alter column identity_hash drop not null;

    create unique index if not exists native_draft_generation_claims_version_id_key
      on public.native_draft_generation_claims(version_id)
      where version_id is not null;

    update public.native_draft_generation_claims claims
    set subject_email = lower(trim(snapshots.payload #>> '{subject,email}'))
    from public.research_snapshots snapshots
    where claims.research_snapshot_id = snapshots.id
      and claims.subject_email is null
      and lower(trim(coalesce(snapshots.payload #>> '{subject,email}', ''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
  end if;

  if to_regclass('public.people_search_leads') is not null then
    alter table public.people_search_leads
      add column if not exists user_id uuid references auth.users(id) on delete cascade,
      add column if not exists apollo_person_id text;
    alter table public.people_search_leads
      alter column linkedin_url drop not null,
      alter column batch_run_id drop not null;
    alter table public.people_search_leads enable row level security;
    drop policy if exists "Enable all access for all users" on public.people_search_leads;
    revoke all on table public.people_search_leads from public, anon, authenticated;
    grant all on table public.people_search_leads to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
