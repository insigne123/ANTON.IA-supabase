do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'campaigns'
  ) then
    alter table public.campaigns
      add column if not exists campaign_type text not null default 'follow_up',
      add column if not exists last_run_at timestamptz,
      add column if not exists last_run_status text,
      add column if not exists last_run_summary jsonb not null default '{}'::jsonb;

    alter table public.campaigns
      drop constraint if exists campaigns_campaign_type_check,
      add constraint campaigns_campaign_type_check
        check (campaign_type in ('follow_up', 'reconnection'));

    alter table public.campaigns
      drop constraint if exists campaigns_last_run_status_check,
      add constraint campaigns_last_run_status_check
        check (last_run_status is null or last_run_status in ('idle', 'success', 'partial', 'failed', 'skipped'));

    update public.campaigns
    set campaign_type = case
      when coalesce(settings->'audience'->>'kind', '') = 'reactivation' then 'reconnection'
      when coalesce(settings->'reconnection'->>'enabled', 'false') = 'true' then 'reconnection'
      else 'follow_up'
    end
    where campaign_type is null or campaign_type not in ('follow_up', 'reconnection');

    create index if not exists campaigns_campaign_type_idx
      on public.campaigns(campaign_type, status, created_at desc);
  end if;
end $$;

notify pgrst, 'reload config';
