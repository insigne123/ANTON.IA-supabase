-- Ensure daily report tasks are scheduled once per organization/day.

drop function if exists public.schedule_daily_mission_tasks();

create or replace function public.schedule_daily_mission_tasks()
returns table (mission_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  r record;
  o record;
  v_has_saved boolean;
  v_has_pending boolean;
  v_searches_today integer;
  v_limit integer;
  v_report_user_id uuid;
  v_report_enabled boolean;
  v_report_recipients text;
begin
  -- Schedule one daily report task per organization with active missions.
  for o in
    select distinct m.organization_id
    from public.antonia_missions m
    where m.status = 'active'
      and m.organization_id is not null
  loop
    select c.daily_report_enabled, c.notification_email
      into v_report_enabled, v_report_recipients
      from public.antonia_config c
      where c.organization_id = o.organization_id;

    if coalesce(v_report_enabled, true) is not true then
      continue;
    end if;

    if coalesce(nullif(trim(v_report_recipients), ''), '') = '' then
      continue;
    end if;

    select m.user_id
      into v_report_user_id
      from public.antonia_missions m
      where m.organization_id = o.organization_id
        and m.status = 'active'
        and m.user_id is not null
      order by m.updated_at desc nulls last, m.created_at desc nulls last
      limit 1;

    if v_report_user_id is null then
      continue;
    end if;

    insert into public.antonia_tasks (mission_id, organization_id, type, status, payload, idempotency_key, created_at)
    values (
      null,
      o.organization_id,
      'GENERATE_REPORT',
      'pending',
      jsonb_build_object(
        'reportType', 'daily',
        'userId', v_report_user_id
      ),
      'org_' || o.organization_id::text || '_daily_report_' || v_today,
      now()
    )
    on conflict do nothing;
  end loop;

  -- Existing mission scheduling logic.
  for r in
    select id, organization_id, user_id, title, params, daily_search_limit
    from public.antonia_missions
    where status = 'active'
  loop
    -- If there are pending/processing tasks due now, do not schedule new ones.
    select exists(
      select 1 from public.antonia_tasks t
      where t.mission_id = r.id
        and t.status in ('pending', 'processing')
        and (t.scheduled_for is null or t.scheduled_for <= now())
    ) into v_has_pending;

    if v_has_pending then
      continue;
    end if;

    -- Prefer enriching from queue if there are saved leads.
    select exists(
      select 1 from public.leads l
      where l.mission_id = r.id
        and l.status = 'saved'
    ) into v_has_saved;

    if v_has_saved then
      insert into public.antonia_tasks (mission_id, organization_id, type, status, payload, idempotency_key, created_at)
      values (
        r.id,
        r.organization_id,
        'ENRICH',
        'pending',
        jsonb_build_object(
          'userId', r.user_id,
          'source', 'queue',
          'enrichmentLevel', coalesce(r.params->>'enrichmentLevel', 'basic'),
          'campaignName', coalesce(r.params->>'campaignName', case when coalesce((r.params->>'autoGenerateCampaign')::boolean, false) then 'Mision: ' || r.title else null end)
        ),
        'mission_' || r.id::text || '_enrich_' || v_today,
        now()
      )
      on conflict do nothing;

      mission_id := r.id;
      return next;
      continue;
    end if;

    -- Otherwise, schedule SEARCH up to mission daily_search_limit.
    select count(*)::integer
      from public.antonia_tasks t
      where t.mission_id = r.id
        and t.type = 'SEARCH'
        and t.created_at >= (date_trunc('day', now() at time zone 'utc'))
    into v_searches_today;

    v_limit := least(5, greatest(coalesce(r.daily_search_limit, 1), 1));
    if v_searches_today >= v_limit then
      continue;
    end if;

    insert into public.antonia_tasks (mission_id, organization_id, type, status, payload, idempotency_key, created_at)
    values (
      r.id,
      r.organization_id,
      'SEARCH',
      'pending',
      jsonb_build_object(
        'userId', r.user_id,
        'jobTitle', r.params->>'jobTitle',
        'location', r.params->>'location',
        'industry', r.params->>'industry',
        'keywords', coalesce(r.params->>'keywords', ''),
        'companySize', coalesce(r.params->>'companySize', ''),
        'seniorities', coalesce(r.params->'seniorities', '[]'::jsonb),
        'enrichmentLevel', coalesce(r.params->>'enrichmentLevel', 'basic'),
        'campaignName', coalesce(r.params->>'campaignName', case when coalesce((r.params->>'autoGenerateCampaign')::boolean, false) then 'Mision: ' || r.title else null end),
        'campaignContext', coalesce(r.params->>'campaignContext', ''),
        'missionTitle', r.title
      ),
      'mission_' || r.id::text || '_search_' || v_today || '_' || (v_searches_today + 1)::text,
      now()
    )
    on conflict do nothing;

    mission_id := r.id;
    return next;
  end loop;
end;
$$;

revoke all on function public.schedule_daily_mission_tasks() from public;
grant execute on function public.schedule_daily_mission_tasks() to service_role;

notify pgrst, 'reload config';
