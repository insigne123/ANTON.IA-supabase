-- Native research workspace, durable run progress, style profiles and templates.
-- This migration is additive and keeps the legacy n8n projection available during cutover.

create extension if not exists pgcrypto;

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

create table if not exists public.outreach_template_cache (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  segment_key text not null,
  offer_hash text not null,
  style_hash text not null,
  template_version text not null,
  subject_template text not null,
  body_template text not null,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_template_cache_segment_check check (length(trim(segment_key)) between 1 and 120),
  constraint outreach_template_cache_offer_hash_check check (offer_hash ~ '^[a-f0-9]{64}$'),
  constraint outreach_template_cache_style_hash_check check (style_hash ~ '^[a-f0-9]{64}$'),
  constraint outreach_template_cache_version_check check (length(trim(template_version)) between 1 and 120),
  constraint outreach_template_cache_metadata_check check (jsonb_typeof(metadata) = 'object'),
  unique (organization_id, segment_key, offer_hash, style_hash, template_version)
);

create table if not exists public.messaging_draft_generation_metadata (
  version_id uuid primary key references public.messaging_draft_versions(id) on delete cascade,
  draft_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  research_snapshot_id uuid references public.research_snapshots(id) on delete restrict,
  generation_method text not null,
  provider text,
  model text,
  prompt_version text not null,
  style_profile_id uuid references public.email_style_profiles(id) on delete set null,
  claim_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint messaging_draft_generation_metadata_method_check check (generation_method in ('model', 'template', 'human', 'fallback')),
  constraint messaging_draft_generation_metadata_claims_check check (jsonb_typeof(claim_ids) = 'array'),
  unique (draft_id, version_id, organization_id, user_id)
);

create index if not exists research_runs_scope_updated_idx
  on public.research_runs(organization_id, user_id, updated_at desc);
create index if not exists research_runs_status_idx
  on public.research_runs(status, updated_at desc);
create index if not exists research_run_items_job_idx
  on public.research_run_items(job_id);
create index if not exists research_run_items_scope_status_idx
  on public.research_run_items(organization_id, user_id, status, position);
create index if not exists email_style_profiles_scope_updated_idx
  on public.email_style_profiles(organization_id, user_id, updated_at desc);
create index if not exists outreach_template_cache_expiry_idx
  on public.outreach_template_cache(organization_id, expires_at);
create index if not exists messaging_draft_generation_snapshot_idx
  on public.messaging_draft_generation_metadata(organization_id, research_snapshot_id, created_at desc);

alter table public.research_runs enable row level security;
alter table public.research_run_items enable row level security;
alter table public.email_style_profiles enable row level security;
alter table public.outreach_template_cache enable row level security;
alter table public.messaging_draft_generation_metadata enable row level security;

revoke all on table public.research_runs, public.research_run_items, public.email_style_profiles, public.outreach_template_cache, public.messaging_draft_generation_metadata from anon;
grant select, insert, update on table public.research_runs, public.research_run_items, public.email_style_profiles to authenticated;
grant select on table public.outreach_template_cache to authenticated;
grant select on table public.messaging_draft_generation_metadata to authenticated;
grant all on table public.research_runs, public.research_run_items, public.email_style_profiles, public.outreach_template_cache to service_role;
grant all on table public.messaging_draft_generation_metadata to service_role;

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

create policy "Authenticated members can read email styles"
  on public.email_style_profiles for select to authenticated
  using (
    organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );
create policy "Authenticated owners can create email styles"
  on public.email_style_profiles for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );
create policy "Authenticated owners can update email styles"
  on public.email_style_profiles for update to authenticated
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
create policy "Authenticated owners can delete email styles"
  on public.email_style_profiles for delete to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );

create policy "Authenticated members can read outreach templates"
  on public.outreach_template_cache for select to authenticated
  using (
    organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );

create policy "Authenticated members can read draft generation metadata"
  on public.messaging_draft_generation_metadata for select to authenticated
  using (
    organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );

-- Existing policies were created across several migrations while RLS was later
-- disabled. Consolidate them before enabling RLS so permissive OR policies do
-- not accidentally widen tenant access.
alter table public.leads enable row level security;
alter table public.enriched_leads enable row level security;

drop policy if exists "Users can view their own leads" on public.leads;
drop policy if exists "Users can insert their own leads" on public.leads;
drop policy if exists "Users can update their own leads" on public.leads;
drop policy if exists "Users can delete their own leads" on public.leads;
drop policy if exists "Members can view org leads" on public.leads;
drop policy if exists "Users can insert org leads" on public.leads;
drop policy if exists "Members can update org leads" on public.leads;
drop policy if exists "Members can delete org leads" on public.leads;
drop policy if exists "Members can view org leads OR own legacy leads" on public.leads;
drop policy if exists "Hybrid Access: Own or Org Leads" on public.leads;
drop policy if exists "Hybrid Insert: Own or Org Leads" on public.leads;
drop policy if exists "Hybrid Update: Own or Org Leads" on public.leads;
drop policy if exists "Hybrid Delete: Own or Org Leads" on public.leads;
drop policy if exists "Org members can view leads" on public.leads;
drop policy if exists "Org members can insert leads" on public.leads;
drop policy if exists "Org members can update leads" on public.leads;
drop policy if exists "Org members can delete leads" on public.leads;

create policy "Tenant members can read leads"
  on public.leads for select to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );
create policy "Tenant members can insert leads"
  on public.leads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (organization_id is null or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
  );
create policy "Tenant members can update leads"
  on public.leads for update to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  )
  with check (
    (user_id = (select auth.uid()) or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
    and (organization_id is null or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
  );
create policy "Tenant members can delete leads"
  on public.leads for delete to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can view their own enriched leads" on public.enriched_leads;
drop policy if exists "Users can insert their own enriched leads" on public.enriched_leads;
drop policy if exists "Users can update their own enriched leads" on public.enriched_leads;
drop policy if exists "Users can delete their own enriched leads" on public.enriched_leads;
drop policy if exists "Users can view own enriched leads" on public.enriched_leads;
drop policy if exists "Org members can view enriched leads" on public.enriched_leads;
drop policy if exists "Org members can insert enriched leads" on public.enriched_leads;
drop policy if exists "Org members can update enriched leads" on public.enriched_leads;
drop policy if exists "Org members can delete enriched leads" on public.enriched_leads;
drop policy if exists "Hybrid Access: Own or Org Enriched Leads" on public.enriched_leads;
drop policy if exists "Hybrid Insert: Own or Org Enriched Leads" on public.enriched_leads;
drop policy if exists "Org members can view enriched leads" on public.enriched_leads;
drop policy if exists "Org members can insert enriched leads" on public.enriched_leads;
drop policy if exists "Org members can update enriched leads" on public.enriched_leads;
drop policy if exists "Org members can delete enriched leads" on public.enriched_leads;

create policy "Tenant members can read enriched leads"
  on public.enriched_leads for select to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );
create policy "Tenant members can insert enriched leads"
  on public.enriched_leads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (organization_id is null or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
  );
create policy "Tenant members can update enriched leads"
  on public.enriched_leads for update to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  )
  with check (
    (user_id = (select auth.uid()) or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
    and (organization_id is null or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
  );
create policy "Tenant members can delete enriched leads"
  on public.enriched_leads for delete to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );

create index if not exists leads_tenant_lookup_idx
  on public.leads(organization_id, user_id, created_at desc);
create index if not exists enriched_leads_tenant_lookup_idx
  on public.enriched_leads(organization_id, user_id, updated_at desc);

create or replace function public.approve_messaging_draft_v1(
  p_draft_id uuid,
  p_version_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_warnings jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent public.messaging_draft_versions%rowtype;
  v_version_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_payload jsonb;
  v_preflight jsonb;
  v_approval jsonb;
begin
  if auth.uid() is distinct from p_user_id and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
  ) then
    raise exception 'draft organization membership is invalid' using errcode = '42501';
  end if;

  select mdv.* into v_parent
  from public.messaging_draft_versions mdv
  join public.messaging_drafts md on md.id = mdv.draft_id
  where mdv.draft_id = p_draft_id
    and mdv.id = p_version_id
    and mdv.organization_id = p_organization_id
    and mdv.user_id = p_user_id
    and md.organization_id = p_organization_id
    and md.current_version_id = mdv.id
  for update;

  if not found then
    raise exception 'draft version is missing or is not current' using errcode = '40400';
  end if;
  if v_parent.lifecycle = 'archived' then
    raise exception 'archived drafts cannot be approved' using errcode = '22023';
  end if;

  v_approval := jsonb_build_object(
    'status', 'approved',
    'decidedBy', p_user_id,
    'decidedAt', v_now,
    'reason', null
  );
  v_preflight := jsonb_build_object(
    'status', 'passed',
    'checkedAt', v_now,
    'errors', '[]'::jsonb,
    'warnings', coalesce(case when jsonb_typeof(p_warnings) = 'array' then p_warnings else '[]'::jsonb end, '[]'::jsonb)
  );
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'draftId', p_draft_id,
    'versionId', v_version_id,
    'organizationId', v_parent.organization_id,
    'userId', v_parent.user_id,
    'researchSnapshotId', v_parent.research_snapshot_id,
    'revision', v_parent.revision + 1,
    'parentVersionId', v_parent.id,
    'lifecycle', 'ready',
    'channel', v_parent.channel,
    'recipient', v_parent.recipient,
    'content', v_parent.content,
    'approval', v_approval,
    'preflight', v_preflight,
    'createdAt', v_now
  );

  insert into public.messaging_draft_versions (
    id, draft_id, organization_id, user_id, research_snapshot_id, revision,
    parent_version_id, lifecycle, channel, recipient, content, approval,
    preflight, payload, content_hash, created_at
  ) values (
    v_version_id, p_draft_id, v_parent.organization_id, v_parent.user_id,
    v_parent.research_snapshot_id, v_parent.revision + 1, v_parent.id,
    'ready', v_parent.channel, v_parent.recipient, v_parent.content,
    v_approval, v_preflight, v_payload, v_parent.content_hash, v_now
  );

  update public.messaging_drafts
  set lifecycle = 'ready', current_revision = v_parent.revision + 1,
      current_version_id = v_version_id, updated_at = v_now
  where id = p_draft_id and current_version_id = p_version_id;

  return v_payload;
end;
$$;

revoke all on function public.approve_messaging_draft_v1(uuid, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.approve_messaging_draft_v1(uuid, uuid, uuid, uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
