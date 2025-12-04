-- Create comments table
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_type text not null, -- 'lead', 'campaign', etc.
  entity_id uuid not null,
  content text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index if not exists comments_org_idx on public.comments(organization_id);
create index if not exists comments_entity_idx on public.comments(entity_type, entity_id);

-- Enable RLS
alter table public.comments enable row level security;

-- Policies
create policy "Users can view comments in their organization"
  on public.comments for select
  using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
    )
  );

create policy "Users can insert comments in their organization"
  on public.comments for insert
  with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid()
    )
  );

create policy "Users can update their own comments"
  on public.comments for update
  using ( user_id = auth.uid() );

create policy "Users can delete their own comments"
  on public.comments for delete
  using ( user_id = auth.uid() );

-- Realtime
alter publication supabase_realtime add table public.comments;
