-- SUPL.IA conversational agent workspace

create extension if not exists pgcrypto;

create table if not exists public.suplia_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nueva conversacion',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.suplia_conversations
  drop constraint if exists suplia_conversations_status_check,
  add constraint suplia_conversations_status_check check (status in ('active', 'archived'));

create table if not exists public.suplia_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.suplia_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  role text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.suplia_messages
  drop constraint if exists suplia_messages_role_check,
  add constraint suplia_messages_role_check check (role in ('user', 'assistant', 'system', 'tool'));

create table if not exists public.suplia_artifacts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.suplia_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  type text not null default 'note',
  title text not null,
  content text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.suplia_pending_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.suplia_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  status text not null default 'pending',
  title text not null,
  description text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error_message text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.suplia_pending_actions
  drop constraint if exists suplia_pending_actions_status_check,
  add constraint suplia_pending_actions_status_check check (status in ('pending', 'approved', 'executed', 'cancelled', 'failed'));

create index if not exists suplia_conversations_org_updated_idx
  on public.suplia_conversations(organization_id, updated_at desc);
create index if not exists suplia_messages_conversation_created_idx
  on public.suplia_messages(conversation_id, created_at asc);
create index if not exists suplia_artifacts_conversation_created_idx
  on public.suplia_artifacts(conversation_id, created_at desc);
create index if not exists suplia_pending_actions_conversation_status_idx
  on public.suplia_pending_actions(conversation_id, status, created_at desc);

alter table public.suplia_conversations enable row level security;
alter table public.suplia_messages enable row level security;
alter table public.suplia_artifacts enable row level security;
alter table public.suplia_pending_actions enable row level security;

drop policy if exists "Org members can view SUPLIA conversations" on public.suplia_conversations;
create policy "Org members can view SUPLIA conversations"
  on public.suplia_conversations for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_conversations.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can insert SUPLIA conversations" on public.suplia_conversations;
create policy "Org members can insert SUPLIA conversations"
  on public.suplia_conversations for insert
  with check (user_id = auth.uid() and exists (select 1 from public.organization_members om where om.organization_id = suplia_conversations.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can update SUPLIA conversations" on public.suplia_conversations;
create policy "Org members can update SUPLIA conversations"
  on public.suplia_conversations for update
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_conversations.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA messages" on public.suplia_messages;
create policy "Org members can view SUPLIA messages"
  on public.suplia_messages for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_messages.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can insert SUPLIA messages" on public.suplia_messages;
create policy "Org members can insert SUPLIA messages"
  on public.suplia_messages for insert
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_messages.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA artifacts" on public.suplia_artifacts;
create policy "Org members can view SUPLIA artifacts"
  on public.suplia_artifacts for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_artifacts.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can insert SUPLIA artifacts" on public.suplia_artifacts;
create policy "Org members can insert SUPLIA artifacts"
  on public.suplia_artifacts for insert
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_artifacts.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can view SUPLIA actions" on public.suplia_pending_actions;
create policy "Org members can view SUPLIA actions"
  on public.suplia_pending_actions for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_pending_actions.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can insert SUPLIA actions" on public.suplia_pending_actions;
create policy "Org members can insert SUPLIA actions"
  on public.suplia_pending_actions for insert
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_pending_actions.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can update SUPLIA actions" on public.suplia_pending_actions;
create policy "Org members can update SUPLIA actions"
  on public.suplia_pending_actions for update
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_pending_actions.organization_id and om.user_id = auth.uid()));

notify pgrst, 'reload config';
