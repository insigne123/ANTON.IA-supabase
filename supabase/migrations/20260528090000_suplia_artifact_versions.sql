-- SUPL.IA artifact metadata and version history

create extension if not exists pgcrypto;

alter table public.suplia_artifacts
  add column if not exists source_message_id uuid references public.suplia_messages(id) on delete set null,
  add column if not exists artifact_kind text,
  add column if not exists status text not null default 'active',
  add column if not exists version_number integer not null default 1,
  add column if not exists updated_at timestamptz not null default now();

alter table public.suplia_artifacts
  drop constraint if exists suplia_artifacts_status_check,
  add constraint suplia_artifacts_status_check check (status in ('active', 'archived', 'deleted'));

alter table public.suplia_artifacts
  drop constraint if exists suplia_artifacts_version_number_check,
  add constraint suplia_artifacts_version_number_check check (version_number >= 1);

create table if not exists public.suplia_artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.suplia_artifacts(id) on delete cascade,
  conversation_id uuid not null references public.suplia_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  source_message_id uuid references public.suplia_messages(id) on delete set null,
  job_id uuid references public.suplia_jobs(id) on delete set null,
  version_number integer not null default 1,
  title text not null,
  content text,
  data jsonb not null default '{}'::jsonb,
  change_summary text,
  created_at timestamptz not null default now(),
  unique(artifact_id, version_number)
);

alter table public.suplia_artifact_versions
  drop constraint if exists suplia_artifact_versions_version_number_check,
  add constraint suplia_artifact_versions_version_number_check check (version_number >= 1);

create index if not exists suplia_artifacts_source_message_idx
  on public.suplia_artifacts(source_message_id, created_at desc);

create index if not exists suplia_artifacts_org_status_idx
  on public.suplia_artifacts(organization_id, status, updated_at desc);

create index if not exists suplia_artifact_versions_artifact_idx
  on public.suplia_artifact_versions(artifact_id, version_number desc);

create index if not exists suplia_artifact_versions_org_idx
  on public.suplia_artifact_versions(organization_id, created_at desc);

alter table public.suplia_artifact_versions enable row level security;

drop policy if exists "Org members can view SUPLIA artifact versions" on public.suplia_artifact_versions;
create policy "Org members can view SUPLIA artifact versions"
  on public.suplia_artifact_versions for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_artifact_versions.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can insert SUPLIA artifact versions" on public.suplia_artifact_versions;
create policy "Org members can insert SUPLIA artifact versions"
  on public.suplia_artifact_versions for insert
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_artifact_versions.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can update SUPLIA artifact versions" on public.suplia_artifact_versions;
create policy "Org members can update SUPLIA artifact versions"
  on public.suplia_artifact_versions for update
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_artifact_versions.organization_id and om.user_id = auth.uid()));

notify pgrst, 'reload config';
