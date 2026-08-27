-- Older clean replays use id as the report identifier. Hosted databases may
-- already use report_id as the primary key, so this migration is directional
-- only when report_id is absent and avoids a redundant production index.
alter table public.lead_research_reports
  add column if not exists report_id text generated always as (id::text) stored;

do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a
      on a.attrelid = t.oid
     and a.attnum = any(i.indkey)
    where n.nspname = 'public'
      and t.relname = 'lead_research_reports'
      and a.attname = 'report_id'
      and i.indisunique
  ) then
    create unique index lead_research_reports_report_id_idx
      on public.lead_research_reports(report_id);
  end if;
end;
$$;

notify pgrst, 'reload schema';
