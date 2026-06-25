-- SUPL.IA multiagent jobs, progress events, memory, and future artifact tables

create extension if not exists pgcrypto;

create table if not exists public.suplia_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.suplia_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  goal text not null,
  job_type text not null default 'general',
  status text not null default 'queued',
  priority integer not null default 0,
  progress_current integer not null default 0,
  progress_total integer not null default 0,
  progress_label text,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  error_message text,
  lock_token text,
  locked_at timestamptz,
  last_heartbeat_at timestamptz,
  queued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  paused_at timestamptz
);

alter table public.suplia_jobs
  drop constraint if exists suplia_jobs_status_check,
  add constraint suplia_jobs_status_check check (status in ('draft', 'planning', 'waiting_approval', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled'));

alter table public.suplia_jobs
  drop constraint if exists suplia_jobs_progress_check,
  add constraint suplia_jobs_progress_check check (progress_current >= 0 and progress_total >= 0 and progress_current <= greatest(progress_total, progress_current));

create table if not exists public.suplia_job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.suplia_jobs(id) on delete cascade,
  conversation_id uuid not null references public.suplia_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  step_order integer not null default 0,
  step_key text not null,
  step_type text not null default 'agent',
  agent_name text,
  title text not null,
  description text,
  status text not null default 'queued',
  depends_on_step_ids uuid[] not null default array[]::uuid[],
  can_run_in_parallel boolean not null default false,
  requires_approval boolean not null default false,
  approval_action_id uuid references public.suplia_pending_actions(id) on delete set null,
  tool_run_id uuid references public.suplia_tool_runs(id) on delete set null,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  error_message text,
  progress_current integer not null default 0,
  progress_total integer not null default 1,
  retry_count integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_for timestamptz not null default now(),
  lock_token text,
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, step_key)
);

alter table public.suplia_job_steps
  drop constraint if exists suplia_job_steps_status_check,
  add constraint suplia_job_steps_status_check check (status in ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'skipped', 'cancelled'));

alter table public.suplia_job_steps
  drop constraint if exists suplia_job_steps_progress_check,
  add constraint suplia_job_steps_progress_check check (progress_current >= 0 and progress_total >= 0 and progress_current <= greatest(progress_total, progress_current));

alter table public.suplia_jobs
  add column if not exists current_step_id uuid references public.suplia_job_steps(id) on delete set null;

create table if not exists public.suplia_agent_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.suplia_jobs(id) on delete cascade,
  step_id uuid references public.suplia_job_steps(id) on delete set null,
  conversation_id uuid not null references public.suplia_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  agent_name text not null,
  status text not null default 'queued',
  model_tier text,
  model_name text,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  reasoning_summary text,
  error_message text,
  token_usage jsonb,
  estimated_cost numeric,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.suplia_agent_runs
  drop constraint if exists suplia_agent_runs_status_check,
  add constraint suplia_agent_runs_status_check check (status in ('queued', 'running', 'completed', 'failed', 'cancelled'));

create table if not exists public.suplia_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.suplia_jobs(id) on delete cascade,
  step_id uuid references public.suplia_job_steps(id) on delete set null,
  agent_run_id uuid references public.suplia_agent_runs(id) on delete set null,
  tool_run_id uuid references public.suplia_tool_runs(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  title text not null,
  message text,
  severity text not null default 'info',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.suplia_job_events
  drop constraint if exists suplia_job_events_severity_check,
  add constraint suplia_job_events_severity_check check (severity in ('debug', 'info', 'success', 'warning', 'error'));

create table if not exists public.suplia_memories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  scope text not null default 'organization',
  memory_type text not null,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0.5,
  status text not null default 'proposed',
  source_conversation_id uuid references public.suplia_conversations(id) on delete set null,
  source_job_id uuid references public.suplia_jobs(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.suplia_memories
  drop constraint if exists suplia_memories_status_check,
  add constraint suplia_memories_status_check check (status in ('inferred', 'proposed', 'approved', 'rejected', 'archived'));

alter table public.suplia_memories
  drop constraint if exists suplia_memories_confidence_check,
  add constraint suplia_memories_confidence_check check (confidence >= 0 and confidence <= 1);

create table if not exists public.suplia_playbooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  description text,
  playbook_type text not null default 'general',
  input_schema jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  guardrails jsonb not null default '{}'::jsonb,
  performance_summary jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suplia_company_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.suplia_jobs(id) on delete cascade,
  company_key text,
  company_name text not null,
  domain text,
  score integer not null default 0,
  score_label text not null default 'uncertain',
  reasons jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  matched_segments jsonb not null default '[]'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.suplia_company_scores
  drop constraint if exists suplia_company_scores_score_check,
  add constraint suplia_company_scores_score_check check (score >= 0 and score <= 100);

create table if not exists public.suplia_lead_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.suplia_jobs(id) on delete cascade,
  lead_key text,
  lead_id uuid,
  email text,
  full_name text,
  company_name text,
  score integer not null default 0,
  score_label text not null default 'uncertain',
  reasons jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  recommended_action text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.suplia_lead_scores
  drop constraint if exists suplia_lead_scores_score_check,
  add constraint suplia_lead_scores_score_check check (score >= 0 and score <= 100);

create table if not exists public.suplia_campaign_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.suplia_jobs(id) on delete cascade,
  campaign_id text,
  preview_type text not null default 'dry_run',
  audience_count integer not null default 0,
  sample_count integer not null default 0,
  excluded_count integer not null default 0,
  risk_summary jsonb not null default '{}'::jsonb,
  sample_messages jsonb not null default '[]'::jsonb,
  preflight_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.suplia_reply_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.suplia_jobs(id) on delete cascade,
  conversation_id uuid references public.suplia_conversations(id) on delete set null,
  contacted_id text,
  thread_key text,
  to_email text,
  subject text,
  html_body text,
  text_body text,
  classification text,
  reasoning_summary text,
  status text not null default 'draft',
  approval_action_id uuid references public.suplia_pending_actions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.suplia_artifacts
  add column if not exists job_id uuid references public.suplia_jobs(id) on delete set null;

alter table public.suplia_pending_actions
  add column if not exists job_id uuid references public.suplia_jobs(id) on delete set null,
  add column if not exists step_id uuid references public.suplia_job_steps(id) on delete set null;

alter table public.suplia_tool_runs
  add column if not exists job_id uuid references public.suplia_jobs(id) on delete set null,
  add column if not exists step_id uuid references public.suplia_job_steps(id) on delete set null,
  add column if not exists agent_run_id uuid references public.suplia_agent_runs(id) on delete set null;

create index if not exists suplia_jobs_org_status_idx on public.suplia_jobs(organization_id, status, updated_at desc);
create index if not exists suplia_jobs_conversation_idx on public.suplia_jobs(conversation_id, created_at desc);
create index if not exists suplia_jobs_queue_idx on public.suplia_jobs(status, priority desc, queued_at asc) where status in ('queued', 'running');
create index if not exists suplia_job_steps_job_order_idx on public.suplia_job_steps(job_id, step_order asc);
create index if not exists suplia_job_steps_status_idx on public.suplia_job_steps(organization_id, status, scheduled_for asc);
create index if not exists suplia_agent_runs_step_idx on public.suplia_agent_runs(step_id, created_at desc);
create index if not exists suplia_job_events_job_created_idx on public.suplia_job_events(job_id, created_at desc);
create index if not exists suplia_memories_org_status_idx on public.suplia_memories(organization_id, status, memory_type, updated_at desc);
create index if not exists suplia_playbooks_org_status_idx on public.suplia_playbooks(organization_id, status, updated_at desc);
create index if not exists suplia_company_scores_job_idx on public.suplia_company_scores(job_id, score desc);
create index if not exists suplia_lead_scores_job_idx on public.suplia_lead_scores(job_id, score desc);
create index if not exists suplia_campaign_previews_job_idx on public.suplia_campaign_previews(job_id, created_at desc);
create index if not exists suplia_reply_drafts_org_status_idx on public.suplia_reply_drafts(organization_id, status, created_at desc);
create index if not exists suplia_artifacts_job_idx on public.suplia_artifacts(job_id, created_at desc);
create index if not exists suplia_pending_actions_job_idx on public.suplia_pending_actions(job_id, status, created_at desc);
create index if not exists suplia_tool_runs_job_idx on public.suplia_tool_runs(job_id, created_at desc);

alter table public.suplia_jobs enable row level security;
alter table public.suplia_job_steps enable row level security;
alter table public.suplia_agent_runs enable row level security;
alter table public.suplia_job_events enable row level security;
alter table public.suplia_memories enable row level security;
alter table public.suplia_playbooks enable row level security;
alter table public.suplia_company_scores enable row level security;
alter table public.suplia_lead_scores enable row level security;
alter table public.suplia_campaign_previews enable row level security;
alter table public.suplia_reply_drafts enable row level security;

drop policy if exists "Org members can view SUPLIA jobs" on public.suplia_jobs;
create policy "Org members can view SUPLIA jobs" on public.suplia_jobs for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_jobs.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can insert SUPLIA jobs" on public.suplia_jobs;
create policy "Org members can insert SUPLIA jobs" on public.suplia_jobs for insert
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_jobs.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can update SUPLIA jobs" on public.suplia_jobs;
create policy "Org members can update SUPLIA jobs" on public.suplia_jobs for update
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_jobs.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA job steps" on public.suplia_job_steps;
create policy "Org members can view SUPLIA job steps" on public.suplia_job_steps for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_job_steps.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can insert SUPLIA job steps" on public.suplia_job_steps;
create policy "Org members can insert SUPLIA job steps" on public.suplia_job_steps for insert
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_job_steps.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can update SUPLIA job steps" on public.suplia_job_steps;
create policy "Org members can update SUPLIA job steps" on public.suplia_job_steps for update
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_job_steps.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA agent runs" on public.suplia_agent_runs;
create policy "Org members can view SUPLIA agent runs" on public.suplia_agent_runs for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_agent_runs.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can insert SUPLIA agent runs" on public.suplia_agent_runs;
create policy "Org members can insert SUPLIA agent runs" on public.suplia_agent_runs for insert
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_agent_runs.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can update SUPLIA agent runs" on public.suplia_agent_runs;
create policy "Org members can update SUPLIA agent runs" on public.suplia_agent_runs for update
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_agent_runs.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA job events" on public.suplia_job_events;
create policy "Org members can view SUPLIA job events" on public.suplia_job_events for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_job_events.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can insert SUPLIA job events" on public.suplia_job_events;
create policy "Org members can insert SUPLIA job events" on public.suplia_job_events for insert
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_job_events.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA memories" on public.suplia_memories;
create policy "Org members can view SUPLIA memories" on public.suplia_memories for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_memories.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can manage SUPLIA memories" on public.suplia_memories;
create policy "Org members can manage SUPLIA memories" on public.suplia_memories for all
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_memories.organization_id and om.user_id = auth.uid()))
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_memories.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA playbooks" on public.suplia_playbooks;
create policy "Org members can view SUPLIA playbooks" on public.suplia_playbooks for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_playbooks.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can manage SUPLIA playbooks" on public.suplia_playbooks;
create policy "Org members can manage SUPLIA playbooks" on public.suplia_playbooks for all
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_playbooks.organization_id and om.user_id = auth.uid()))
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_playbooks.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA company scores" on public.suplia_company_scores;
create policy "Org members can view SUPLIA company scores" on public.suplia_company_scores for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_company_scores.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can manage SUPLIA company scores" on public.suplia_company_scores;
create policy "Org members can manage SUPLIA company scores" on public.suplia_company_scores for all
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_company_scores.organization_id and om.user_id = auth.uid()))
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_company_scores.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA lead scores" on public.suplia_lead_scores;
create policy "Org members can view SUPLIA lead scores" on public.suplia_lead_scores for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_lead_scores.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can manage SUPLIA lead scores" on public.suplia_lead_scores;
create policy "Org members can manage SUPLIA lead scores" on public.suplia_lead_scores for all
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_lead_scores.organization_id and om.user_id = auth.uid()))
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_lead_scores.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA campaign previews" on public.suplia_campaign_previews;
create policy "Org members can view SUPLIA campaign previews" on public.suplia_campaign_previews for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_campaign_previews.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can manage SUPLIA campaign previews" on public.suplia_campaign_previews;
create policy "Org members can manage SUPLIA campaign previews" on public.suplia_campaign_previews for all
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_campaign_previews.organization_id and om.user_id = auth.uid()))
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_campaign_previews.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA reply drafts" on public.suplia_reply_drafts;
create policy "Org members can view SUPLIA reply drafts" on public.suplia_reply_drafts for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_reply_drafts.organization_id and om.user_id = auth.uid()));
drop policy if exists "Org members can manage SUPLIA reply drafts" on public.suplia_reply_drafts;
create policy "Org members can manage SUPLIA reply drafts" on public.suplia_reply_drafts for all
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_reply_drafts.organization_id and om.user_id = auth.uid()))
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_reply_drafts.organization_id and om.user_id = auth.uid()));

notify pgrst, 'reload config';
