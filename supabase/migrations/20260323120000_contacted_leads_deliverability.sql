do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'contacted_leads'
  ) then
    alter table public.contacted_leads
      add column if not exists delivered_at timestamptz,
      add column if not exists read_receipt_message_id text,
      add column if not exists delivery_receipt_message_id text,
      add column if not exists delivery_status text not null default 'unknown',
      add column if not exists bounced_at timestamptz,
      add column if not exists bounce_category text,
      add column if not exists bounce_reason text;

    update public.contacted_leads
    set delivery_status = case
      when delivery_status is not null and delivery_status <> '' then delivery_status
      when bounced_at is not null or status = 'failed' then 'soft_bounced'
      when replied_at is not null then 'replied'
      when clicked_at is not null or coalesce(click_count, 0) > 0 then 'clicked'
      when opened_at is not null then 'opened'
      when delivered_at is not null then 'delivered'
      else 'unknown'
    end;

    create index if not exists contacted_leads_delivery_status_idx
      on public.contacted_leads(delivery_status, last_interaction_at desc);

    create index if not exists contacted_leads_bounced_at_idx
      on public.contacted_leads(bounced_at desc)
      where bounced_at is not null;
  end if;
end $$;
