-- Enable RLS
alter table if exists public.leads enable row level security;

-- Create leads table
create table public.leads (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  title text not null,
  company text not null,
  email text,
  avatar text,
  status text not null default 'saved',
  email_enrichment jsonb,
  industry text,
  company_website text,
  company_linkedin text,
  linkedin_url text,
  location text,
  country text,
  city text,
  created_at timestamptz not null default now(),
  
  constraint leads_pkey primary key (id)
);

-- RLS Policies
create policy "Users can view their own leads"
  on public.leads for select
  using (auth.uid() = user_id);

create policy "Users can insert their own leads"
  on public.leads for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own leads"
  on public.leads for update
  using (auth.uid() = user_id);

create policy "Users can delete their own leads"
  on public.leads for delete
  using (auth.uid() = user_id);
