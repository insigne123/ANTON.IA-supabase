do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'lead_responses'
  ) then
    alter table public.lead_responses
      add column if not exists contacted_id text;

    create index if not exists lead_responses_contacted_id_idx
      on public.lead_responses(contacted_id, created_at desc)
      where contacted_id is not null;
  end if;
end $$;

notify pgrst, 'reload config';
