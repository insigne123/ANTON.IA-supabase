-- SUPL.IA persistent cache for public and approval-gated company research

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    create extension pgcrypto;
  end if;
end $$;

create table if not exists public.suplia_research_cache (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  cache_key text not null,
  domain text,
  query text,
  status text not null default 'completed',
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  fetched_at timestamptz,
  hit_count integer not null default 0,
  last_hit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, cache_key)
);

alter table public.suplia_research_cache
  drop constraint if exists suplia_research_cache_hit_count_check,
  add constraint suplia_research_cache_hit_count_check check (hit_count >= 0);

create index if not exists suplia_research_cache_lookup_idx
  on public.suplia_research_cache(organization_id, provider, cache_key, expires_at desc);

create index if not exists suplia_research_cache_expiry_idx
  on public.suplia_research_cache(expires_at);

create index if not exists suplia_research_cache_domain_idx
  on public.suplia_research_cache(organization_id, domain, provider)
  where domain is not null;

alter table public.suplia_research_cache enable row level security;

drop policy if exists "Org members can view SUPLIA research cache" on public.suplia_research_cache;
create policy "Org members can view SUPLIA research cache" on public.suplia_research_cache for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_research_cache.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can manage SUPLIA research cache" on public.suplia_research_cache;
create policy "Org members can manage SUPLIA research cache" on public.suplia_research_cache for all
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_research_cache.organization_id and om.user_id = auth.uid()))
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_research_cache.organization_id and om.user_id = auth.uid()));

notify pgrst, 'reload config';
