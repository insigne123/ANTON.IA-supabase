-- Reapply the schema-tolerant counter after the local migration history has
-- already recorded the earlier reconciliation.

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
