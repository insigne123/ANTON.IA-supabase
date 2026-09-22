-- Forward-only. Remote ledger 20260922223650. Validated in isolated PGlite.
-- Keep durable identities without blocking the existing dispatch retention job.
-- A missing dispatch fails closed rather than silently freeing a used slot.
alter table public.cowork_send_batches add column last_dispatch_id uuid;
alter table public.cowork_company_send_days add column dispatch_id uuid;

create function public.cowork_schedule_send_batch(p_org uuid, p_user uuid, p_run uuid, p_hash text, p_plan jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.cowork_send_batch_proposals; c public.bulk_campaigns; b public.cowork_send_batches;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text, 421));
  select * into p from public.cowork_send_batch_proposals
    where run_id=p_run and organization_id=p_org and user_id=p_user and proposal_hash=p_hash;
  if not found then raise exception 'Proposal unavailable'; end if;
  select * into c from public.bulk_campaigns where id=p.campaign_id and organization_id=p_org and user_id=p_user for update;
  if not found or c.revision<>p.campaign_revision or c.status='rejected' then raise exception 'Campaign changed'; end if;
  select * into b from public.cowork_send_batches where campaign_id=c.id;
  if found then
    if b.proposal_hash=p_hash and b.run_id=p_run then return; end if;
    raise exception 'Batch already scheduled; explicit rescheduling required';
  end if;
  if c.status='approved' then raise exception 'Pause campaign before scheduling'; end if;
  if jsonb_typeof(p_plan)<>'array' or jsonb_array_length(p_plan)<>jsonb_array_length(c.recipients) then
    raise exception 'Invalid recipient plan';
  end if;
  if exists(select 1 from jsonb_array_elements(p_plan) x where not exists
    (select 1 from jsonb_array_elements(c.recipients) r where lower(r->>'email')=x->>'email')) then
    raise exception 'Recipient not in campaign';
  end if;
  if (select count(distinct x->>'email') from jsonb_array_elements(p_plan) x)<>jsonb_array_length(p_plan)
    or exists(select 1 from jsonb_array_elements(p_plan) x
      where coalesce(jsonb_array_length(x->'companyKeys'),0) not between 1 and 2) then
    raise exception 'Invalid company keys or duplicate recipients';
  end if;
  insert into public.cowork_send_batches(campaign_id,user_id,organization_id,run_id,campaign_revision,spacing_minutes,proposal_hash)
    values(c.id,p_user,p_org,p_run,p.campaign_revision,p.spacing_minutes,p_hash);
  insert into public.cowork_company_send_days(organization_id,user_id,company_key,send_day,campaign_id,recipient_email,batch_run_id)
    select p_org,p_user,k,(x->>'sendDay')::date,c.id,x->>'email',p_run
      from jsonb_array_elements(p_plan) x cross join lateral jsonb_array_elements_text(x->'companyKeys') k;
  -- A reservation conflict rolls back BOTH inserts.
end; $$;
revoke all on function public.cowork_schedule_send_batch(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cowork_schedule_send_batch(uuid,uuid,uuid,text,jsonb) to service_role;

-- A persistent claim is never expired on a timer: an unknown provider outcome
-- must be reconciled before another recipient can use the campaign slot.
create function public.cowork_claim_send_slot(p_org uuid,p_user uuid,p_campaign uuid,p_dispatch uuid,p_email text,p_company_keys text[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare b public.cowork_send_batches; c public.bulk_campaigns; d public.outbound_dispatches;
  slot public.cowork_company_send_days; today date := (now() at time zone 'America/Santiago')::date;
  first_day date; v_company_key text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text, 421));
  select * into c from public.bulk_campaigns where id=p_campaign and organization_id=p_org and user_id=p_user for update;
  if not found or c.status<>'approved' then return false; end if;
  select * into b from public.cowork_send_batches where campaign_id=p_campaign and organization_id=p_org and user_id=p_user for update;
  if not found then return true; end if; -- Legacy campaigns keep their existing claim protocol.
  if b.status<>'scheduled' or not b.guards_enabled or b.campaign_revision<>c.revision then return false; end if;
  select * into d from public.outbound_dispatches where id=p_dispatch and organization_id=p_org and user_id=p_user;
  if not found or d.status<>'sending' or lower(d.metadata->'recipient'->>'email')<>lower(p_email)
    or d.idempotency_key<>'bulk:'||p_campaign::text||':'||d.draft_id::text then return false; end if;
  if b.last_dispatch_id is not null and b.last_dispatch_id<>p_dispatch then
    select * into d from public.outbound_dispatches where id=b.last_dispatch_id;
    if not found or d.status<>'sent' or d.completed_at is null
      or d.completed_at + make_interval(mins=>b.spacing_minutes)>now() then return false; end if;
  end if;
  select min(send_day) into first_day from public.cowork_company_send_days
    where organization_id=p_org and campaign_id=p_campaign and recipient_email=lower(p_email);
  if first_day is null or first_day>today then return false; end if;
  if coalesce(cardinality(p_company_keys),0) not between 1 and 2 then return false; end if;
  -- Check ALL aliases before writing any claim; returning false must not leave
  -- partial claims for a second company key.
  if exists(select 1 from public.cowork_company_send_days s
    where s.organization_id=p_org and s.company_key=any(p_company_keys) and s.send_day=today
    and (s.campaign_id<>p_campaign or s.recipient_email<>lower(p_email)
      or (s.dispatch_id is not null and s.dispatch_id<>p_dispatch))) then return false; end if;
  foreach v_company_key in array p_company_keys loop
  select * into slot from public.cowork_company_send_days
    where organization_id=p_org and company_key=v_company_key and send_day=today for update;
  if found then
    if slot.campaign_id<>p_campaign or slot.recipient_email<>lower(p_email)
      or (slot.dispatch_id is not null and slot.dispatch_id<>p_dispatch) then return false; end if;
    update public.cowork_company_send_days set dispatch_id=p_dispatch
      where organization_id=p_org and company_key=v_company_key and send_day=today;
  else
    insert into public.cowork_company_send_days(organization_id,user_id,company_key,send_day,campaign_id,recipient_email,batch_run_id,dispatch_id)
      values(p_org,p_user,v_company_key,today,p_campaign,lower(p_email),b.run_id,p_dispatch);
  end if;
  end loop;
  update public.cowork_send_batches set last_dispatch_id=p_dispatch where campaign_id=p_campaign;
  return true;
end; $$;
revoke all on function public.cowork_claim_send_slot(uuid,uuid,uuid,uuid,text,text[]) from public,anon,authenticated;
grant execute on function public.cowork_claim_send_slot(uuid,uuid,uuid,uuid,text,text[]) to service_role;
