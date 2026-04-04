create table if not exists public.lead_research_reports (
  id uuid primary key default gen_random_uuid()
);

alter table public.lead_research_reports
  add column if not exists scope_key text,
  add column if not exists organization_id uuid,
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists lead_ref text,
  add column if not exists lead_id text,
  add column if not exists email text,
  add column if not exists company_domain text,
  add column if not exists company_name text,
  add column if not exists provider text,
  add column if not exists report jsonb,
  add column if not exists generated_at timestamptz,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lead_research_reports'
      and column_name = 'organization_id'
      and data_type <> 'uuid'
  ) then
    execute $sql$
      alter table public.lead_research_reports
      alter column organization_id type uuid
      using (
        case
          when organization_id is null then null
          when organization_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then organization_id::text::uuid
          else null
        end
      )
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lead_research_reports'
      and column_name = 'user_id'
      and data_type <> 'uuid'
  ) then
    execute $sql$
      alter table public.lead_research_reports
      alter column user_id type uuid
      using (
        case
          when user_id is null then null
          when user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then user_id::text::uuid
          else null
        end
      )
    $sql$;
  end if;
end $$;

update public.lead_research_reports
set
  scope_key = coalesce(nullif(scope_key, ''), organization_id::text, concat('user:', user_id::text), 'legacy'),
  lead_ref = coalesce(nullif(lead_ref, ''), lead_id, email, concat('legacy:', ctid::text)),
  provider = coalesce(nullif(provider, ''), 'n8n'),
  report = coalesce(report, '{}'::jsonb),
  generated_at = coalesce(generated_at, now()),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  scope_key is null
  or lead_ref is null
  or provider is null
  or report is null
  or generated_at is null
  or created_at is null
  or updated_at is null;

alter table public.lead_research_reports
  alter column scope_key set not null,
  alter column lead_ref set not null,
  alter column provider set default 'n8n',
  alter column provider set not null,
  alter column report set not null,
  alter column generated_at set default now(),
  alter column generated_at set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

delete from public.lead_research_reports a
using public.lead_research_reports b
where a.ctid < b.ctid
  and a.scope_key = b.scope_key
  and a.lead_ref = b.lead_ref;

create unique index if not exists lead_research_reports_scope_ref_idx
  on public.lead_research_reports(scope_key, lead_ref);

create index if not exists lead_research_reports_org_updated_idx
  on public.lead_research_reports(organization_id, updated_at desc);

create index if not exists lead_research_reports_email_idx
  on public.lead_research_reports(scope_key, email)
  where email is not null;

create index if not exists lead_research_reports_company_domain_idx
  on public.lead_research_reports(scope_key, company_domain)
  where company_domain is not null;

alter table public.lead_research_reports enable row level security;

drop policy if exists "Users can view scoped lead research reports" on public.lead_research_reports;
create policy "Users can view scoped lead research reports"
  on public.lead_research_reports
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert scoped lead research reports" on public.lead_research_reports;
create policy "Users can insert scoped lead research reports"
  on public.lead_research_reports
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update scoped lead research reports" on public.lead_research_reports;
create policy "Users can update scoped lead research reports"
  on public.lead_research_reports
  for update
  using (auth.uid() = user_id);
