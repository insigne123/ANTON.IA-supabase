-- SUPL.IA tool execution traceability and approval metadata

create extension if not exists pgcrypto;

create table if not exists public.suplia_tool_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.suplia_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  message_id uuid references public.suplia_messages(id) on delete set null,
  pending_action_id uuid references public.suplia_pending_actions(id) on delete set null,
  tool_name text not null,
  status text not null default 'queued',
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb,
  error_message text,
  risk_level text not null default 'low',
  requires_approval boolean not null default false,
  approval_kind text not null default 'none',
  approval_reason text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  model_tier text,
  model_name text,
  estimated_cost numeric,
  created_at timestamptz not null default now()
);

alter table public.suplia_tool_runs
  drop constraint if exists suplia_tool_runs_status_check,
  add constraint suplia_tool_runs_status_check check (status in ('queued', 'running', 'completed', 'requires_approval', 'cancelled', 'failed'));

alter table public.suplia_tool_runs
  drop constraint if exists suplia_tool_runs_risk_level_check,
  add constraint suplia_tool_runs_risk_level_check check (risk_level in ('low', 'medium', 'high', 'critical'));

alter table public.suplia_tool_runs
  drop constraint if exists suplia_tool_runs_approval_kind_check,
  add constraint suplia_tool_runs_approval_kind_check check (approval_kind in ('none', 'simple', 'strong'));

alter table public.suplia_tool_runs
  drop constraint if exists suplia_tool_runs_duration_ms_check,
  add constraint suplia_tool_runs_duration_ms_check check (duration_ms is null or duration_ms >= 0);

alter table public.suplia_pending_actions
  add column if not exists risk_level text not null default 'medium',
  add column if not exists requires_approval boolean not null default true,
  add column if not exists approval_kind text not null default 'simple',
  add column if not exists approval_reason text,
  add column if not exists tool_name text,
  add column if not exists tool_run_id uuid references public.suplia_tool_runs(id) on delete set null;

alter table public.suplia_pending_actions
  drop constraint if exists suplia_pending_actions_risk_level_check,
  add constraint suplia_pending_actions_risk_level_check check (risk_level in ('low', 'medium', 'high', 'critical'));

alter table public.suplia_pending_actions
  drop constraint if exists suplia_pending_actions_approval_kind_check,
  add constraint suplia_pending_actions_approval_kind_check check (approval_kind in ('none', 'simple', 'strong'));

create index if not exists suplia_tool_runs_conversation_created_idx
  on public.suplia_tool_runs(conversation_id, created_at desc);

create index if not exists suplia_tool_runs_org_status_idx
  on public.suplia_tool_runs(organization_id, status, created_at desc);

create index if not exists suplia_tool_runs_pending_action_idx
  on public.suplia_tool_runs(pending_action_id);

create index if not exists suplia_pending_actions_tool_run_idx
  on public.suplia_pending_actions(tool_run_id);

alter table public.suplia_tool_runs enable row level security;

drop policy if exists "Org members can view SUPLIA tool runs" on public.suplia_tool_runs;
create policy "Org members can view SUPLIA tool runs"
  on public.suplia_tool_runs for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_tool_runs.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can insert SUPLIA tool runs" on public.suplia_tool_runs;
create policy "Org members can insert SUPLIA tool runs"
  on public.suplia_tool_runs for insert
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_tool_runs.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can update SUPLIA tool runs" on public.suplia_tool_runs;
create policy "Org members can update SUPLIA tool runs"
  on public.suplia_tool_runs for update
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_tool_runs.organization_id and om.user_id = auth.uid()));

notify pgrst, 'reload config';
