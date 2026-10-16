-- Production already has these; no migration in this repository created them, so a database built from the repository broke
-- «Historial de campañas» (campaigns and campaign_steps: 403), «Pipeline» and «Tabla» (opportunities: 403), «Bajas»
-- (unsubscribed_emails: 403) and the excluded domains every send checks (excluded_domains did not exist: 404); the browser services
-- of activity, comments, the CRM and notifications read the other tables below. Table, policies and index are production's, read
-- from its schema (16 Oct 2026). Additive and idempotent: in production every statement is a no-op.

create table if not exists public.excluded_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  domain text not null,
  reason text,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);
create index if not exists idx_excluded_domains_org_domain on public.excluded_domains (organization_id, domain);
alter table public.excluded_domains enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'excluded_domains' and policyname = 'Users can view excluded domains for their org') then
    create policy "Users can view excluded domains for their org" on public.excluded_domains for select
      using (organization_id in (select organization_members.organization_id from public.organization_members where organization_members.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'excluded_domains' and policyname = 'Users can insert excluded domains for their org') then
    create policy "Users can insert excluded domains for their org" on public.excluded_domains for insert
      with check (organization_id in (select organization_members.organization_id from public.organization_members where organization_members.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'excluded_domains' and policyname = 'Users can delete excluded domains for their org') then
    create policy "Users can delete excluded domains for their org" on public.excluded_domains for delete
      using (organization_id in (select organization_members.organization_id from public.organization_members where organization_members.user_id = auth.uid()));
  end if;
end $$;

-- PostgREST needs table privileges in addition to RLS (20260821120000_grant_authenticated_app_tables.sql). Each table already has
-- its policies for the people and organizations it belongs to; the session clients of those pages read and write them.
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update, delete on public.opportunities to authenticated;
grant select, insert, update, delete on public.unsubscribed_emails to authenticated;
grant select, insert, delete on public.excluded_domains to authenticated;
grant select, insert, update, delete on public.campaign_steps to authenticated;
grant select, insert, update, delete on public.activity_logs to authenticated;
grant select, insert, update, delete on public.comments to authenticated;
grant select, insert, update, delete on public.enriched_opportunities to authenticated;
grant select, insert, update, delete on public.antonia_config to authenticated;
grant select, insert, update, delete on public.antonia_daily_usage to authenticated;
grant select, insert, update, delete on public.antonia_lead_events to authenticated;
grant select, insert, update, delete on public.antonia_missions to authenticated;
grant select, insert, update, delete on public.antonia_reports to authenticated;
grant select, insert, update, delete on public.antonia_tasks to authenticated;
