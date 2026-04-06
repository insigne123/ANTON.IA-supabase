-- 1. Create comments table if it doesn't exist
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

-- 2. Create Indexes (idempotent)
create index if not exists comments_org_idx on public.comments(organization_id);
create index if not exists comments_entity_idx on public.comments(entity_type, entity_id);

-- 3. Enable RLS
alter table public.comments enable row level security;

-- 4. Drop existing policies to avoid conflicts when re-creating
drop policy if exists "Users can view comments in their organization" on public.comments;
drop policy if exists "Users can insert comments in their organization" on public.comments;
drop policy if exists "Users can update their own comments" on public.comments;
drop policy if exists "Users can delete their own comments" on public.comments;

-- 5. Re-create Policies
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

-- 6. Enable Realtime (check if already enabled to avoid error, or just run it - 'add table' is usually safe to re-run but might throw if exists depending on version. Better to use a do block or just ignore error if it happens, but standard SQL doesn't have 'add table if not exists' for publication. 
-- However, Supabase usually handles this gracefully or we can catch it. 
-- Let's just run it, if it fails it means it's already there.)
do $$
begin
  alter publication supabase_realtime add table public.comments;
exception when duplicate_object then
  null;
end;
$$;

-- 7. Force Schema Cache Reload
NOTIFY pgrst, 'reload config';
