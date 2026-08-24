-- Queue ANTONIA reports for manual SUPL.IA review after the inbox schema exists.

create or replace function public.enqueue_antonia_report_review_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.organization_id is null then
    return new;
  end if;

  insert into public.suplia_review_items (
    organization_id,
    item_type,
    messaging_draft_id,
    antonia_report_id,
    requested_by_user_id,
    sender_user_id,
    title,
    summary,
    status,
    severity,
    metadata,
    created_at
  ) values (
    new.organization_id,
    'antonia_report',
    null,
    new.id,
    null,
    null,
    left(coalesce(
      nullif(btrim(new.summary_data ->> 'title'), ''),
      nullif(btrim(new.summary_data ->> 'reportTitle'), ''),
      nullif(btrim(new.summary_data ->> 'name'), ''),
      'Informe ANTONIA: ' || coalesce(nullif(btrim(new.type), ''), 'report')
    ), 180),
    left(coalesce(
      nullif(btrim(new.summary_data ->> 'summary'), ''),
      nullif(btrim(new.summary_data ->> 'overview'), ''),
      nullif(btrim(new.summary_data ->> 'description'), ''),
      nullif(btrim(new.summary_data ->> 'message'), ''),
      'Informe ANTONIA disponible para revision.'
    ), 500),
    'pending',
    case lower(btrim(coalesce(new.summary_data ->> 'severity', new.summary_data ->> 'priority', '')))
      when 'attention' then 'attention'
      when 'critical' then 'critical'
      else 'normal'
    end,
    jsonb_build_object(
      'source', 'antonia_report',
      'reportType', nullif(btrim(new.type), ''),
      'reportCreatedAt', new.created_at
    ),
    new.created_at
  ) on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_antonia_report_review_item() from public;

drop trigger if exists antonia_reports_enqueue_suplia_review_item on public.antonia_reports;
create trigger antonia_reports_enqueue_suplia_review_item
  after insert on public.antonia_reports
  for each row execute function public.enqueue_antonia_report_review_item();

-- Existing reports predate the trigger. Backfill them once without exposing
-- their HTML body in the review list.
insert into public.suplia_review_items (
  organization_id,
  item_type,
  messaging_draft_id,
  antonia_report_id,
  requested_by_user_id,
  sender_user_id,
  title,
  summary,
  status,
  severity,
  metadata,
  created_at
)
select
  report.organization_id,
  'antonia_report',
  null,
  report.id,
  null,
  null,
  left(coalesce(
    nullif(btrim(report.summary_data ->> 'title'), ''),
    nullif(btrim(report.summary_data ->> 'reportTitle'), ''),
    nullif(btrim(report.summary_data ->> 'name'), ''),
    'Informe ANTONIA: ' || coalesce(nullif(btrim(report.type), ''), 'report')
  ), 180),
  left(coalesce(
    nullif(btrim(report.summary_data ->> 'summary'), ''),
    nullif(btrim(report.summary_data ->> 'overview'), ''),
    nullif(btrim(report.summary_data ->> 'description'), ''),
    nullif(btrim(report.summary_data ->> 'message'), ''),
    'Informe ANTONIA disponible para revision.'
  ), 500),
  'pending',
  case lower(btrim(coalesce(report.summary_data ->> 'severity', report.summary_data ->> 'priority', '')))
    when 'attention' then 'attention'
    when 'critical' then 'critical'
    else 'normal'
  end,
  jsonb_build_object(
    'source', 'antonia_report',
    'reportType', nullif(btrim(report.type), ''),
    'reportCreatedAt', report.created_at
  ),
  report.created_at
from public.antonia_reports report
where report.organization_id is not null
on conflict do nothing;

notify pgrst, 'reload schema';
