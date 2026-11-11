-- The cache of research reports never kept a row in production. The table there still has the columns of the earlier research
-- service: four of them were required and its key had no default, so every write of the app, which sends none of them, was
-- rejected and logged as «cache store failed». Each reply draft and each reconnection asked for the research again.
-- A database built from this repository already has the table the app writes to: there this does nothing.
do $fix$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.lead_research_reports'::regclass and attname = 'base_cache_key' and not attisdropped
  ) then
    return;
  end if;

  alter table public.lead_research_reports
    alter column report_id set default (gen_random_uuid())::text,
    alter column base_cache_key drop not null,
    alter column cache_key drop not null,
    alter column requested_depth drop not null,
    alter column status drop not null;
end
$fix$;
