-- ANTONIA: Automated Agent Tables
-- Applies to: antonia_missions, antonia_tasks, antonia_logs, antonia_config, antonia_app_suggestions, integration_tokens

-- 1. CONFIGURATION
create table if not exists antonia_config (
  organization_id uuid not null primary key references organizations(id) on delete cascade,
  notification_email text,
  daily_report_enabled boolean default true,
  instant_alerts_enabled boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. INTEGRATION TOKENS (Offline Access)
create table if not exists integration_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  refresh_token text not null, -- Encrypted application side or trusted env
  updated_at timestamptz default now(),
  primary key (user_id, provider)
);

-- 3. MISSIONS (High Level Goals)
create table if not exists antonia_missions (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  title text not null,
  status text default 'active' check (status in ('active', 'paused', 'completed', 'failed')),
  goal_summary text, -- "Find CEOs in Fintech"
  params jsonb default '{}'::jsonb, -- Filters, criteria
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4. TASKS (Execution Queue)
create table if not exists antonia_tasks (
  id uuid default uuid_generate_v4() primary key,
  mission_id uuid references antonia_missions(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  type text not null check (type in ('SEARCH', 'ENRICH', 'CONTACT', 'REPORT', 'ALERT')),
  status text default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  payload jsonb default '{}'::jsonb,
  result jsonb,
  error_message text,
  processing_started_at timestamptz, -- For Locking
  idempotency_key text, -- To prevent duplicates
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists idx_antonia_tasks_idempotency on antonia_tasks(idempotency_key) where idempotency_key is not null;

-- 5. LOGS (User Facing)
create table if not exists antonia_logs (
  id uuid default uuid_generate_v4() primary key,
  mission_id uuid references antonia_missions(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  level text default 'info' check (level in ('info', 'success', 'warning', 'error')),
  message text not null,
  details jsonb,
  created_at timestamptz default now()
);

-- 6. METRICS (For Self-Improvement)
create table if not exists antonia_metrics (
  id uuid default uuid_generate_v4() primary key,
  mission_id uuid references antonia_missions(id) on delete cascade,
  metric_type text not null, -- 'reply_rate', 'leads_found'
  value numeric not null,
  context jsonb,
  recorded_at timestamptz default now()
);

-- 7. SUGGESTIONS (Private / Admin Only)
create table if not exists antonia_app_suggestions (
  id uuid default uuid_generate_v4() primary key,
  suggestion_type text not null check (suggestion_type in ('feature', 'optimization', 'bug')),
  description text not null,
  context text, -- "Struggled to find leads in Automotive"
  suggested_by_mission_id uuid references antonia_missions(id),
  is_read boolean default false,
  created_at timestamptz default now()
);

-- RLS POLICIES
alter table antonia_config enable row level security;
alter table integration_tokens enable row level security;
alter table antonia_missions enable row level security;
alter table antonia_tasks enable row level security;
alter table antonia_logs enable row level security;
alter table antonia_metrics enable row level security;
-- Note: antonia_app_suggestions RLS will be manual or strictly restricted

-- Common Policy: Org/User Access
create policy "Users can view own org config" on antonia_config for select using (organization_id in (select organization_id from organization_members where user_id = auth.uid()));
create policy "Users can update own org config" on antonia_config for update using (organization_id in (select organization_id from organization_members where user_id = auth.uid()));
create policy "Users can insert own org config" on antonia_config for insert with check (organization_id in (select organization_id from organization_members where user_id = auth.uid()));

create policy "Users manage own tokens" on integration_tokens for all using (user_id = auth.uid());

create policy "Users view own org missions" on antonia_missions for select using (organization_id in (select organization_id from organization_members where user_id = auth.uid()));
create policy "Users manage own org missions" on antonia_missions for all using (organization_id in (select organization_id from organization_members where user_id = auth.uid()));

create policy "Users view own org tasks" on antonia_tasks for select using (organization_id in (select organization_id from organization_members where user_id = auth.uid()));
create policy "Users view own org logs" on antonia_logs for select using (organization_id in (select organization_id from organization_members where user_id = auth.uid()));

-- Admin Suggestions Policy: CHANGE 'YOUR_ADMIN_UUID' TO YOUR ACTUAL UUID
-- For now, we allow insert by anyone (the agent running as the user) but Select only by specific ID if possible, or just rely on UI hiding.
create policy "Agent can insert suggestions" on antonia_app_suggestions for insert with check (true);
