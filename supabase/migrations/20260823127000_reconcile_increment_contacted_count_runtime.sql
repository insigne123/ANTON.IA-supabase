-- Final runtime-discovered version for environments with different lead
-- projection columns.

create or replace function public.increment_contacted_count(row_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_schema_name text;
  v_table_name text;
  v_count_column text;
  v_id_column text;
begin
  select c.table_schema, c.table_name, c.column_name
  into v_schema_name, v_table_name, v_count_column
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'enriched_leads'
    and c.column_name = 'contacted_count'
  limit 1;
  select c.column_name
  into v_id_column
  from information_schema.columns c
  where c.table_schema = v_schema_name
    and c.table_name = v_table_name
    and c.column_name = 'id'
  limit 1;

  if v_table_name is not null and v_id_column is not null then
    execute format(
      'update %I.%I set %I = coalesce(%I, 0) + 1 where %I::text = $1',
      v_schema_name, v_table_name, v_count_column, v_count_column, v_id_column
    ) using row_id;
    get diagnostics v_updated = row_count;
  end if;

  select c.table_schema, c.table_name, c.column_name
  into v_schema_name, v_table_name, v_count_column
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'enriched_opportunities'
    and c.column_name = 'contacted_count'
  limit 1;
  select c.column_name
  into v_id_column
  from information_schema.columns c
  where c.table_schema = v_schema_name
    and c.table_name = v_table_name
    and c.column_name = 'id'
  limit 1;

  if v_updated = 0 and v_table_name is not null and v_id_column is not null then
    execute format(
      'update %I.%I set %I = coalesce(%I, 0) + 1 where %I::text = $1',
      v_schema_name, v_table_name, v_count_column, v_count_column, v_id_column
    ) using row_id;
  end if;
end;
$$;
