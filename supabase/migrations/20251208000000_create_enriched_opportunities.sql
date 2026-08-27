-- Recover the original table creation SQL that was kept outside the CLI
-- migration directory. Its timestamp intentionally precedes the tracked
-- 20251219 migration that adds phone fields to this table.

create table if not exists public.enriched_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  full_name text,
  email text,
  company_name text,
  title text,
  linkedin_url text,
  created_at timestamp with time zone default now(),
  data jsonb default '{}'::jsonb
);

alter table public.enriched_opportunities enable row level security;

drop policy if exists "Users can view their own or org enriched opportunities" on public.enriched_opportunities;
create policy "Users can view their own or org enriched opportunities"
  on public.enriched_opportunities for select
  using (
    auth.uid() = user_id
    or (
      organization_id is not null
      and organization_id in (
        select organization_id
        from public.organization_members
        where user_id = auth.uid()
      )
    )
  );

drop policy if exists "Users can insert their own or org enriched opportunities" on public.enriched_opportunities;
create policy "Users can insert their own or org enriched opportunities"
  on public.enriched_opportunities for insert
  with check (
    auth.uid() = user_id
    or (
      organization_id is not null
      and organization_id in (
        select organization_id
        from public.organization_members
        where user_id = auth.uid()
      )
    )
  );

drop policy if exists "Users can update their own or org enriched opportunities" on public.enriched_opportunities;
create policy "Users can update their own or org enriched opportunities"
  on public.enriched_opportunities for update
  using (
    auth.uid() = user_id
    or (
      organization_id is not null
      and organization_id in (
        select organization_id
        from public.organization_members
        where user_id = auth.uid()
      )
    )
  );

drop policy if exists "Users can delete their own or org enriched opportunities" on public.enriched_opportunities;
create policy "Users can delete their own or org enriched opportunities"
  on public.enriched_opportunities for delete
  using (
    auth.uid() = user_id
    or (
      organization_id is not null
      and organization_id in (
        select organization_id
        from public.organization_members
        where user_id = auth.uid()
      )
    )
  );
