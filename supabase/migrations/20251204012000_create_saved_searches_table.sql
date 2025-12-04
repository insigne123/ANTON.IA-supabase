-- Create saved_searches table
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  criteria jsonb not null,
  is_shared boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index if not exists saved_searches_org_idx on public.saved_searches(organization_id);
create index if not exists saved_searches_user_idx on public.saved_searches(user_id);

-- Enable RLS
alter table public.saved_searches enable row level security;

-- Policies
create policy "Users can view own searches"
  on public.saved_searches for select
  using ( user_id = auth.uid() );

create policy "Users can view shared searches in their organization"
  on public.saved_searches for select
  using (
    is_shared = true and
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
    )
  );

create policy "Users can insert searches in their organization"
  on public.saved_searches for insert
  with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
    )
  );

create policy "Users can update their own searches"
  on public.saved_searches for update
  using ( user_id = auth.uid() );

create policy "Users can delete their own searches"
  on public.saved_searches for delete
  using ( user_id = auth.uid() );

-- Realtime
alter publication supabase_realtime add table public.saved_searches;
