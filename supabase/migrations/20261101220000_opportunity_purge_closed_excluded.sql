-- Audit O1 (1 Nov 2026): the daily search keeps every open tender it reads, so the next day's listing does not pay to evaluate it
-- again; in 30 days that was 20,153 rows, 82 % excluded by the evaluation and never opened. Once such a tender closed a month ago
-- (or a hiring signal or post was last seen two months ago) nothing will list it again, so it is removed. Only what the evaluation
-- excluded, came from the automatic search and nobody touched: no work, activity, notice, document, report, task, note, participant,
-- contact or offer. At most p_limit rows per call; the daily cron calls it. Its evaluations go with it (on delete cascade).
create or replace function public.opportunity_purge_closed_excluded(p_limit integer default 2000)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with doomed as (
    select o.id
    from public.commercial_opportunities o
    where o.data->>'origin' = 'automatic'
      and o.data->>'evaluation' = 'excluded'
      and o.status = 'new'
      and o.claimed_by is null
      and ((o.deadline_at is not null and o.deadline_at < now() - interval '30 days')
        or (o.deadline_at is null and o.last_seen_at < now() - interval '60 days'))
      and not exists (select 1 from public.opportunity_work w where w.organization_id = o.organization_id and w.opportunity_id = o.id)
      and not exists (select 1 from public.opportunity_activity a where a.organization_id = o.organization_id and a.opportunity_id = o.id)
      and not exists (select 1 from public.opportunity_notifications n where n.organization_id = o.organization_id and n.opportunity_id = o.id)
      and not exists (select 1 from public.opportunity_documents d where d.organization_id = o.organization_id and d.opportunity_id = o.id)
      and not exists (select 1 from public.opportunity_reports r where r.organization_id = o.organization_id and r.opportunity_id = o.id)
      and not exists (select 1 from public.opportunity_tasks t where t.organization_id = o.organization_id and t.opportunity_id = o.id)
      and not exists (select 1 from public.opportunity_chat_messages m where m.organization_id = o.organization_id and m.opportunity_id = o.id)
      and not exists (select 1 from public.opportunity_participants p where p.organization_id = o.organization_id and p.opportunity_id = o.id)
      and not exists (select 1 from public.opportunity_contact_links c where c.organization_id = o.organization_id and c.opportunity_id = o.id)
      and not exists (select 1 from public.opportunity_offer_drafts f where f.organization_id = o.organization_id and f.opportunity_id = o.id)
    order by o.deadline_at nulls last
    limit greatest(0, least(coalesce(p_limit, 2000), 5000))
  )
  delete from public.commercial_opportunities o using doomed where o.id = doomed.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.opportunity_purge_closed_excluded(integer) from public, anon, authenticated;
grant execute on function public.opportunity_purge_closed_excluded(integer) to service_role;
