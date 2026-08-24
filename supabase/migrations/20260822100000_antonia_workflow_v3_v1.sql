-- Canonical, additive persistence for the ANTON.IA Research v3 and Drafting v1
-- workflows. These tables intentionally do not reference or mutate the native
-- research/messaging tables; workflow outputs remain separately auditable.

create table if not exists public.antonia_workflow_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  user_company_profile jsonb not null default '{}'::jsonb,
  icp jsonb not null default '{}'::jsonb,
  research_config jsonb not null default '{}'::jsonb,
  writing_style jsonb not null default '{}'::jsonb,
  profile_revision integer not null default 1,
  style_revision integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint antonia_workflow_settings_json_check check (
    jsonb_typeof(user_company_profile) = 'object'
    and jsonb_typeof(icp) = 'object'
    and jsonb_typeof(research_config) = 'object'
    and jsonb_typeof(writing_style) = 'object'
  ),
  constraint antonia_workflow_settings_revision_check check (
    profile_revision >= 1 and style_revision >= 1
  )
);
create table if not exists public.antonia_company_research_cache (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cache_key text not null,
  payload jsonb not null,
  generated_at timestamptz not null,
  expires_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, cache_key),
  constraint antonia_company_research_cache_key_check check (length(trim(cache_key)) between 1 and 300),
  constraint antonia_company_research_cache_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint antonia_company_research_cache_expiry_check check (expires_at > generated_at)
);
create table if not exists public.antonia_workflow_research_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enriched_lead_id text references public.enriched_leads(id) on delete set null,
  lead_ref text not null,
  generation_id uuid not null,
  result_revision integer not null,
  workflow_version text not null,
  provider_mode text not null,
  raw_result jsonb not null,
  cache_key text not null,
  priority text not null,
  recommendation text not null,
  functional_role text,
  segment text,
  assigned_angle jsonb,
  send_order integer,
  wait_suggested_days integer not null default 0,
  research_insufficient boolean not null default false,
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint antonia_workflow_research_results_lead_ref_check check (length(trim(lead_ref)) between 1 and 500),
  constraint antonia_workflow_research_results_version_check check (workflow_version = 'antonia-research-v3'),
  constraint antonia_workflow_research_results_provider_mode_check check (provider_mode in ('local', 'mock', 'n8n')),
  constraint antonia_workflow_research_results_payload_check check (jsonb_typeof(raw_result) = 'object'),
  constraint antonia_workflow_research_results_cache_key_check check (length(trim(cache_key)) between 1 and 300),
  constraint antonia_workflow_research_results_priority_check check (priority in ('A', 'B', 'C')),
  constraint antonia_workflow_research_results_recommendation_check check (
    recommendation in (
      'enviar_personalizado',
      'enviar_con_revision',
      'nutrir_o_descartar',
      'no_enviar_generico',
      'diferir_a_otra_tanda'
    )
  ),
  constraint antonia_workflow_research_results_angle_check check (
    assigned_angle is null or jsonb_typeof(assigned_angle) = 'object'
  ),
  constraint antonia_workflow_research_results_revision_check check (result_revision >= 1),
  constraint antonia_workflow_research_results_order_check check (send_order is null or send_order >= 1),
  constraint antonia_workflow_research_results_wait_check check (wait_suggested_days between 0 and 3650),
  unique (id, organization_id, user_id),
  unique (organization_id, user_id, lead_ref, result_revision)
);
create table if not exists public.antonia_segment_templates (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  segment text not null,
  payload jsonb not null,
  style_revision integer not null,
  generated_at timestamptz not null,
  expires_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, segment),
  constraint antonia_segment_templates_segment_check check (length(trim(segment)) between 1 and 500),
  constraint antonia_segment_templates_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint antonia_segment_templates_revision_check check (style_revision >= 1),
  constraint antonia_segment_templates_expiry_check check (expires_at > generated_at)
);
create table if not exists public.antonia_workflow_email_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workflow_research_result_id uuid not null,
  lead_ref text not null,
  generation_id uuid not null,
  draft_series_key text not null,
  draft_revision integer not null,
  workflow_version text not null,
  provider_mode text not null,
  style_revision integer not null,
  profile_revision integer not null,
  raw_draft jsonb not null,
  subject text,
  body text,
  alternative_subject text,
  angle_used text,
  personalization_data text,
  supporting_url text,
  cta text,
  quality jsonb not null,
  quality_ok boolean not null,
  no_send_reason text,
  wait_suggested_days integer not null default 0,
  suggested_send_at timestamptz,
  schedule_state text not null default 'not_scheduled',
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint antonia_workflow_email_drafts_lead_ref_check check (length(trim(lead_ref)) between 1 and 500),
  constraint antonia_workflow_email_drafts_series_key_check check (draft_series_key ~ '^[a-f0-9]{64}$'),
  constraint antonia_workflow_email_drafts_revision_check check (draft_revision >= 1),
  constraint antonia_workflow_email_drafts_version_check check (workflow_version = 'antonia-redaccion-v1'),
  constraint antonia_workflow_email_drafts_provider_mode_check check (provider_mode in ('local', 'mock', 'n8n')),
  constraint antonia_workflow_email_drafts_style_revision_check check (style_revision >= 1 and profile_revision >= 1),
  constraint antonia_workflow_email_drafts_payload_check check (
    jsonb_typeof(raw_draft) = 'object' and jsonb_typeof(quality) = 'object'
  ),
  constraint antonia_workflow_email_drafts_subject_check check (subject is null or length(trim(subject)) between 1 and 998),
  constraint antonia_workflow_email_drafts_body_check check (body is null or length(trim(body)) between 1 and 100000),
  constraint antonia_workflow_email_drafts_supporting_url_check check (
    supporting_url is null or supporting_url ~* '^https?://[^[:space:]]+$'
  ),
  constraint antonia_workflow_email_drafts_wait_check check (wait_suggested_days between 0 and 3650),
  constraint antonia_workflow_email_drafts_schedule_state_check check (schedule_state = 'not_scheduled'),
  constraint antonia_workflow_email_drafts_draft_content_check check (
    (no_send_reason is not null and length(trim(no_send_reason)) > 0)
    or (subject is not null and body is not null)
  ),
  unique (id, organization_id, user_id),
  unique (organization_id, user_id, draft_series_key, draft_revision),
  foreign key (workflow_research_result_id, organization_id, user_id)
    references public.antonia_workflow_research_results(id, organization_id, user_id) on delete restrict
);
create index if not exists antonia_company_research_cache_fresh_idx
  on public.antonia_company_research_cache(organization_id, expires_at);
create index if not exists antonia_workflow_research_results_recent_idx
  on public.antonia_workflow_research_results(organization_id, user_id, generated_at desc);
create index if not exists antonia_workflow_research_results_lead_idx
  on public.antonia_workflow_research_results(organization_id, user_id, lead_ref, result_revision desc);
create index if not exists antonia_workflow_research_results_cache_idx
  on public.antonia_workflow_research_results(organization_id, cache_key, generated_at desc);
create index if not exists antonia_workflow_research_results_priority_idx
  on public.antonia_workflow_research_results(organization_id, user_id, priority, segment, generated_at desc);
create index if not exists antonia_workflow_research_results_insufficient_idx
  on public.antonia_workflow_research_results(organization_id, user_id, generated_at desc)
  where research_insufficient = false;
create index if not exists antonia_segment_templates_fresh_idx
  on public.antonia_segment_templates(organization_id, style_revision, expires_at);
create index if not exists antonia_workflow_email_drafts_recent_idx
  on public.antonia_workflow_email_drafts(organization_id, user_id, generated_at desc);
create index if not exists antonia_workflow_email_drafts_research_idx
  on public.antonia_workflow_email_drafts(workflow_research_result_id, generated_at desc);
create index if not exists antonia_workflow_email_drafts_schedule_idx
  on public.antonia_workflow_email_drafts(organization_id, user_id, schedule_state, suggested_send_at);
create index if not exists antonia_workflow_email_drafts_quality_idx
  on public.antonia_workflow_email_drafts(organization_id, user_id, quality_ok, generated_at desc);
create index if not exists antonia_workflow_email_drafts_personalization_idx
  on public.antonia_workflow_email_drafts(organization_id, user_id, generated_at desc)
  where personalization_data is not null;
create index if not exists antonia_workflow_email_drafts_content_search_idx
  on public.antonia_workflow_email_drafts
  using gin (to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(body, '')));
create or replace function public.antonia_workflow_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create or replace function public.antonia_workflow_assign_research_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    concat('antonia-workflow-research:', new.organization_id::text, ':', new.user_id::text, ':', new.lead_ref),
    0
  ));
  select coalesce(max(result_revision), 0) + 1
  into new.result_revision
  from public.antonia_workflow_research_results
  where organization_id = new.organization_id
    and user_id = new.user_id
    and lead_ref = new.lead_ref;
  return new;
end;
$$;
create or replace function public.antonia_workflow_assign_draft_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    concat('antonia-workflow-draft:', new.organization_id::text, ':', new.user_id::text, ':', new.draft_series_key),
    0
  ));
  select coalesce(max(draft_revision), 0) + 1
  into new.draft_revision
  from public.antonia_workflow_email_drafts
  where organization_id = new.organization_id
    and user_id = new.user_id
    and draft_series_key = new.draft_series_key;
  return new;
end;
$$;
create or replace function public.antonia_workflow_reject_history_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception '% history rows are immutable', tg_table_name using errcode = '55000';
end;
$$;
revoke all on function public.antonia_workflow_set_updated_at() from public, anon, authenticated;
revoke all on function public.antonia_workflow_assign_research_revision() from public, anon, authenticated;
revoke all on function public.antonia_workflow_assign_draft_revision() from public, anon, authenticated;
revoke all on function public.antonia_workflow_reject_history_update() from public, anon, authenticated;
drop trigger if exists antonia_workflow_settings_set_updated_at on public.antonia_workflow_settings;
create trigger antonia_workflow_settings_set_updated_at
  before update on public.antonia_workflow_settings
  for each row execute function public.antonia_workflow_set_updated_at();
drop trigger if exists antonia_company_research_cache_set_updated_at on public.antonia_company_research_cache;
create trigger antonia_company_research_cache_set_updated_at
  before update on public.antonia_company_research_cache
  for each row execute function public.antonia_workflow_set_updated_at();
drop trigger if exists antonia_segment_templates_set_updated_at on public.antonia_segment_templates;
create trigger antonia_segment_templates_set_updated_at
  before update on public.antonia_segment_templates
  for each row execute function public.antonia_workflow_set_updated_at();
drop trigger if exists antonia_workflow_research_results_assign_revision on public.antonia_workflow_research_results;
create trigger antonia_workflow_research_results_assign_revision
  before insert on public.antonia_workflow_research_results
  for each row execute function public.antonia_workflow_assign_research_revision();
drop trigger if exists antonia_workflow_email_drafts_assign_revision on public.antonia_workflow_email_drafts;
create trigger antonia_workflow_email_drafts_assign_revision
  before insert on public.antonia_workflow_email_drafts
  for each row execute function public.antonia_workflow_assign_draft_revision();
drop trigger if exists antonia_workflow_research_results_immutable on public.antonia_workflow_research_results;
create trigger antonia_workflow_research_results_immutable
  before update on public.antonia_workflow_research_results
  for each row execute function public.antonia_workflow_reject_history_update();
drop trigger if exists antonia_workflow_email_drafts_immutable on public.antonia_workflow_email_drafts;
create trigger antonia_workflow_email_drafts_immutable
  before update on public.antonia_workflow_email_drafts
  for each row execute function public.antonia_workflow_reject_history_update();
alter table public.antonia_workflow_settings enable row level security;
alter table public.antonia_company_research_cache enable row level security;
alter table public.antonia_workflow_research_results enable row level security;
alter table public.antonia_segment_templates enable row level security;
alter table public.antonia_workflow_email_drafts enable row level security;
revoke all on table public.antonia_workflow_settings from anon, authenticated;
revoke all on table public.antonia_company_research_cache from anon, authenticated;
revoke all on table public.antonia_workflow_research_results from anon, authenticated;
revoke all on table public.antonia_segment_templates from anon, authenticated;
revoke all on table public.antonia_workflow_email_drafts from anon, authenticated;
grant select on table public.antonia_workflow_settings to authenticated;
grant select on table public.antonia_company_research_cache to authenticated;
grant select on table public.antonia_workflow_research_results to authenticated;
grant select on table public.antonia_segment_templates to authenticated;
grant select on table public.antonia_workflow_email_drafts to authenticated;
grant all on table public.antonia_workflow_settings to service_role;
grant all on table public.antonia_company_research_cache to service_role;
grant all on table public.antonia_workflow_research_results to service_role;
grant all on table public.antonia_segment_templates to service_role;
grant all on table public.antonia_workflow_email_drafts to service_role;
drop policy if exists "Members can view ANTON.IA workflow settings" on public.antonia_workflow_settings;
create policy "Members can view ANTON.IA workflow settings"
  on public.antonia_workflow_settings for select to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = antonia_workflow_settings.organization_id
        and om.user_id = auth.uid()
    )
  );
drop policy if exists "Members can view ANTON.IA company cache" on public.antonia_company_research_cache;
create policy "Members can view ANTON.IA company cache"
  on public.antonia_company_research_cache for select to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = antonia_company_research_cache.organization_id
        and om.user_id = auth.uid()
    )
  );
drop policy if exists "Users can view own ANTON.IA research results" on public.antonia_workflow_research_results;
create policy "Users can view own ANTON.IA research results"
  on public.antonia_workflow_research_results for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.organization_members om
      where om.organization_id = antonia_workflow_research_results.organization_id
        and om.user_id = auth.uid()
    )
  );
drop policy if exists "Members can view ANTON.IA segment templates" on public.antonia_segment_templates;
create policy "Members can view ANTON.IA segment templates"
  on public.antonia_segment_templates for select to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = antonia_segment_templates.organization_id
        and om.user_id = auth.uid()
    )
  );
drop policy if exists "Users can view own ANTON.IA workflow drafts" on public.antonia_workflow_email_drafts;
create policy "Users can view own ANTON.IA workflow drafts"
  on public.antonia_workflow_email_drafts for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.organization_members om
      where om.organization_id = antonia_workflow_email_drafts.organization_id
        and om.user_id = auth.uid()
    )
  );
notify pgrst, 'reload schema';
