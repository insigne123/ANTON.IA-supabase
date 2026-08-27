-- Repair schema drift for the native research workspace.
-- The original migration version is marked as applied remotely, but these
-- durable run tables were missing from that deployed schema.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    create extension pgcrypto;
  end if;
end $$;

create table if not exists public.research_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued',
  total_count integer not null default 0,
  completed_count integer not null default 0,
  failed_count integer not null default 0,
  request_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint research_runs_status_check check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  constraint research_runs_counts_check check (
    total_count >= 0 and completed_count >= 0 and failed_count >= 0
    and completed_count + failed_count <= total_count
  ),
  constraint research_runs_payload_check check (jsonb_typeof(request_payload) = 'object'),
  unique (id, organization_id, user_id)
);

create table if not exists public.research_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.lead_research_jobs(id) on delete cascade,
  lead_ref text not null,
  position integer not null default 0,
  status text not null default 'queued',
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_run_items_status_check check (status in ('queued', 'running', 'completed', 'partial', 'insufficient_data', 'failed', 'cancelled')),
  constraint research_run_items_position_check check (position >= 0),
  constraint research_run_items_lead_ref_check check (length(trim(lead_ref)) between 1 and 500),
  unique (run_id, job_id),
  unique (run_id, position),
  foreign key (run_id, organization_id, user_id)
    references public.research_runs(id, organization_id, user_id) on delete cascade
);

create index if not exists research_runs_scope_updated_idx
  on public.research_runs(organization_id, user_id, updated_at desc);
create index if not exists research_runs_status_idx
  on public.research_runs(status, updated_at desc);
create index if not exists research_run_items_job_idx
  on public.research_run_items(job_id);
create index if not exists research_run_items_scope_status_idx
  on public.research_run_items(organization_id, user_id, status, position);

alter table public.research_runs enable row level security;
alter table public.research_run_items enable row level security;

revoke all on table public.research_runs, public.research_run_items from anon;
grant select, insert, update on table public.research_runs, public.research_run_items to authenticated;
grant all on table public.research_runs, public.research_run_items to service_role;

drop policy if exists "Authenticated members can read research runs" on public.research_runs;
drop policy if exists "Authenticated members can create research runs" on public.research_runs;
drop policy if exists "Authenticated owners can update research runs" on public.research_runs;
drop policy if exists "Authenticated members can read research run items" on public.research_run_items;
drop policy if exists "Authenticated owners can create research run items" on public.research_run_items;
drop policy if exists "Authenticated owners can update research run items" on public.research_run_items;

create policy "Authenticated members can read research runs"
  on public.research_runs for select to authenticated
  using (
    organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );

create policy "Authenticated members can create research runs"
  on public.research_runs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );

create policy "Authenticated owners can update research runs"
  on public.research_runs for update to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );

create policy "Authenticated members can read research run items"
  on public.research_run_items for select to authenticated
  using (
    organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );

create policy "Authenticated owners can create research run items"
  on public.research_run_items for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.lead_research_jobs lrj
      where lrj.id = research_run_items.job_id
        and lrj.organization_id = research_run_items.organization_id
        and lrj.user_id = research_run_items.user_id
    )
  );

create policy "Authenticated owners can update research run items"
  on public.research_run_items for update to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.lead_research_jobs lrj
      where lrj.id = research_run_items.job_id
        and lrj.organization_id = research_run_items.organization_id
        and lrj.user_id = research_run_items.user_id
    )
  );

notify pgrst, 'reload schema';
