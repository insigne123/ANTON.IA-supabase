-- Enriched Leads
create table if not exists public.enriched_leads (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text,
  email text,
  company_name text,
  title text,
  linkedin_url text,
  data jsonb,
  created_at timestamptz not null default now(),
  constraint enriched_leads_pkey primary key (id)
);
alter table public.enriched_leads enable row level security;

create policy "Users can view their own enriched leads" on public.enriched_leads for select using (auth.uid() = user_id);
create policy "Users can insert their own enriched leads" on public.enriched_leads for insert with check (auth.uid() = user_id);
create policy "Users can update their own enriched leads" on public.enriched_leads for update using (auth.uid() = user_id);
create policy "Users can delete their own enriched leads" on public.enriched_leads for delete using (auth.uid() = user_id);

-- Opportunities
create table if not exists public.opportunities (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  company_name text,
  job_url text,
  status text,
  data jsonb,
  created_at timestamptz not null default now(),
  constraint opportunities_pkey primary key (id)
);
alter table public.opportunities enable row level security;

create policy "Users can view their own opportunities" on public.opportunities for select using (auth.uid() = user_id);
create policy "Users can insert their own opportunities" on public.opportunities for insert with check (auth.uid() = user_id);
create policy "Users can update their own opportunities" on public.opportunities for update using (auth.uid() = user_id);
create policy "Users can delete their own opportunities" on public.opportunities for delete using (auth.uid() = user_id);

-- Contacted Leads
create table if not exists public.contacted_leads (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text,
  status text,
  sent_at timestamptz,
  subject text,
  message_id text,
  provider text,
  data jsonb,
  created_at timestamptz not null default now(),
  constraint contacted_leads_pkey primary key (id)
);
alter table public.contacted_leads enable row level security;

create policy "Users can view their own contacted leads" on public.contacted_leads for select using (auth.uid() = user_id);
create policy "Users can insert their own contacted leads" on public.contacted_leads for insert with check (auth.uid() = user_id);
create policy "Users can update their own contacted leads" on public.contacted_leads for update using (auth.uid() = user_id);
create policy "Users can delete their own contacted leads" on public.contacted_leads for delete using (auth.uid() = user_id);

-- Campaigns
create table if not exists public.campaigns (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  status text,
  steps jsonb,
  created_at timestamptz not null default now(),
  constraint campaigns_pkey primary key (id)
);
alter table public.campaigns enable row level security;

create policy "Users can view their own campaigns" on public.campaigns for select using (auth.uid() = user_id);
create policy "Users can insert their own campaigns" on public.campaigns for insert with check (auth.uid() = user_id);
create policy "Users can update their own campaigns" on public.campaigns for update using (auth.uid() = user_id);
create policy "Users can delete their own campaigns" on public.campaigns for delete using (auth.uid() = user_id);

-- Unified Sheet
create table if not exists public.unified_sheet (
  gid text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text,
  kind text,
  stage text,
  owner text,
  notes text,
  updated_at timestamptz,
  constraint unified_sheet_pkey primary key (gid)
);
alter table public.unified_sheet enable row level security;

create policy "Users can view their own unified sheet rows" on public.unified_sheet for select using (auth.uid() = user_id);
create policy "Users can insert their own unified sheet rows" on public.unified_sheet for insert with check (auth.uid() = user_id);
create policy "Users can update their own unified sheet rows" on public.unified_sheet for update using (auth.uid() = user_id);
create policy "Users can delete their own unified sheet rows" on public.unified_sheet for delete using (auth.uid() = user_id);

-- Profiles
create table if not exists public.profiles (
  id uuid not null references auth.users(id) on delete cascade,
  signature text,
  company_profile jsonb,
  updated_at timestamptz,
  constraint profiles_pkey primary key (id)
);
alter table public.profiles enable row level security;

create policy "Users can view their own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can insert their own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);
