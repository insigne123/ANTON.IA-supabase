-- Reconcile legacy functions with the current production schema without
-- changing their service-role boundaries or deleting existing data.

alter table public.contacted_leads
  add column if not exists reply_message_id text,
  add column if not exists reply_subject text,
  add column if not exists reply_snippet text;

alter table public.lead_research_reports
  add column if not exists id text generated always as (report_id) stored;

create or replace function public.increment_contacted_count(row_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_schema_name text := 'public';
  v_table_name text;
  v_count_column text := 'contacted_count';
  v_id_column text := 'id';
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'enriched_leads'
      and column_name = 'contacted_count'
  ) then
    v_table_name := 'enriched_leads';
    execute format(
      'update %I.%I set %I = coalesce(%I, 0) + 1 where %I::text = $1',
      v_schema_name, v_table_name, v_count_column, v_count_column, v_id_column
    )
      using row_id;
    get diagnostics v_updated = row_count;
  end if;

  if v_updated = 0 and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'enriched_opportunities'
      and column_name = 'contacted_count'
  ) then
    v_table_name := 'enriched_opportunities';
    execute format(
      'update %I.%I set %I = coalesce(%I, 0) + 1 where %I::text = $1',
      v_schema_name, v_table_name, v_count_column, v_count_column, v_id_column
    )
      using row_id;
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.restore_batch_version(uuid, text)') is not null then
    execute 'alter function public.restore_batch_version(uuid, text) set search_path = public, extensions';
  end if;
end $$;

notify pgrst, 'reload schema';
