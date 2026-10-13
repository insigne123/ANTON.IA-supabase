create table public.opportunity_company_context (
 organization_id uuid primary key references public.organizations(id), offer text not null check(length(offer) between 20 and 10000),
 services text[] not null, territories text[] not null default '{}', exclusions text[] not null default '{}',
 priority text not null default 'balanced' check(priority in ('hiring','posts','balanced')),
 criteria jsonb not null default '{}', revision bigint not null default 1,
 automation boolean not null default false, hour integer not null default 8 check(hour between 0 and 23),
 approved_by uuid not null references auth.users(id), approved_at timestamptz not null default now(),
 check(cardinality(services) between 1 and 30 and cardinality(territories)<=20 and cardinality(exclusions)<=30)
);
create table public.opportunity_budget_months (
 organization_id uuid not null references public.organizations(id), period date not null,
 spent_micro_usd bigint not null default 0 check(spent_micro_usd>=0), reserved_micro_usd bigint not null default 0 check(reserved_micro_usd>=0),
 primary key(organization_id,period), check(extract(day from period)=1)
);
create table public.opportunity_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), opportunity_id uuid,
 requested_by uuid not null references auth.users(id), kind text not null check(kind in ('criteria','tenders','hiring','posts','evaluate','research','chat')),
 dedupe_key text not null check(length(dedupe_key)<=500), state text not null default 'queued' check(state in ('queued','running','waiting','ready','failed','blocked','cancelled')),
 payload jsonb not null default '{}' check(pg_column_size(payload)<=65536), result jsonb,
 lease_token uuid, lease_until timestamptz, attempts integer not null default 0, error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,dedupe_key),
 foreign key(organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade
);
create index opportunity_jobs_pending_idx on public.opportunity_jobs(state,updated_at,created_at);
create table public.opportunity_budget_reservations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, period date not null,
 job_id uuid not null references public.opportunity_jobs(id), step_key text not null,
 category text not null check(category in ('sources','evaluation','research','chat','other')),
 held_micro_usd bigint not null check(held_micro_usd between 1 and 750000), cost_micro_usd bigint check(cost_micro_usd>=0),
 state text not null default 'reserved' check(state in ('reserved','settled','uncertain')),
 receipt jsonb, created_at timestamptz not null default now(), unique(job_id,step_key),
 foreign key(organization_id,period) references public.opportunity_budget_months(organization_id,period)
);
create table public.opportunity_ai_results (
 reservation_id uuid primary key references public.opportunity_budget_reservations(id),
 organization_id uuid not null references public.organizations(id), data jsonb not null check(pg_column_size(data)<=1048576),
 created_at timestamptz not null default now()
);
create table public.opportunity_evaluations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null,
 profile_revision bigint not null, content_hash text not null, verdict text not null check(verdict in ('recommended','review','excluded','pending')),
 reason text not null check(length(reason)<=2000), service text, evidence jsonb not null default '[]', model text, created_at timestamptz not null default now(),
 unique(opportunity_id,profile_revision,content_hash),
 foreign key(organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade
);

create function public.opportunity_budget_reserve(p_org uuid,p_job uuid,p_step text,p_category text,p_micro bigint,p_lease uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_period date:=date_trunc('month',now() at time zone 'UTC')::date; v_bucket public.opportunity_budget_months;
 v_existing public.opportunity_budget_reservations; v_id uuid; v_category bigint; v_limit bigint;
begin
 if not exists(select 1 from public.opportunity_jobs j where id=p_job and organization_id=p_org and state='running' and lease_until>now() and lease_token=p_lease
   and (public.is_organization_admin(p_org,j.requested_by) or (j.opportunity_id is not null and public.opportunity_can_read(p_org,j.requested_by,j.opportunity_id))))
   then raise exception 'OPPORTUNITY_JOB_REQUIRED'; end if;
 v_limit:=case p_category when 'sources' then 8000000 when 'evaluation' then 3000000 when 'research' then 6000000 when 'chat' then 2000000 when 'other' then 1000000 else 0 end;
 if p_micro<1 or p_micro>750000 or length(p_step)>200 or v_limit=0 then raise exception 'OPPORTUNITY_BAD_RESERVATION'; end if;
 -- Initialize with legacy billed/estimated searches already performed this month; do not seed contacts or reset usage.
 insert into public.opportunity_budget_months(organization_id,period,spent_micro_usd)
 select p_org,v_period,coalesce(sum(ceil(cost_estimate_usd*1000000)),0)::bigint from public.commercial_opportunity_runs
   where organization_id=p_org and started_at>=v_period::timestamp at time zone 'UTC' on conflict do nothing;
 select * into v_bucket from public.opportunity_budget_months where organization_id=p_org and period=v_period for update;
 select * into v_existing from public.opportunity_budget_reservations where job_id=p_job and step_key=p_step;
 if found then return jsonb_build_object('admitted',true,'fresh',false,'id',v_existing.id,'state',v_existing.state); end if;
 -- Uncertain older-month charges remain exposure: a calendar rollover never releases a pending provider receipt.
 select coalesce(sum(held_micro_usd),0) into v_category from public.opportunity_budget_reservations
   where organization_id=p_org and period<>v_period and state<>'settled';
 if v_bucket.spent_micro_usd+v_bucket.reserved_micro_usd+v_category+p_micro>20000000 then return jsonb_build_object('admitted',false); end if;
 select coalesce(sum(case when state='settled' then cost_micro_usd else held_micro_usd end),0) into v_category
   from public.opportunity_budget_reservations where organization_id=p_org and category=p_category and (period=v_period or state<>'settled');
 if v_category+p_micro>v_limit then return jsonb_build_object('admitted',false); end if;
 -- One research may not consume more than USD0.75 across its extraction and synthesis steps.
 if p_category='research' and (select coalesce(sum(case when state='settled' then cost_micro_usd else held_micro_usd end),0)
   from public.opportunity_budget_reservations where job_id=p_job)+p_micro>750000 then return jsonb_build_object('admitted',false); end if;
 insert into public.opportunity_budget_reservations(organization_id,period,job_id,step_key,category,held_micro_usd)
 values(p_org,v_period,p_job,p_step,p_category,p_micro) returning id into v_id;
 update public.opportunity_budget_months set reserved_micro_usd=reserved_micro_usd+p_micro where organization_id=p_org and period=v_period;
 return jsonb_build_object('admitted',true,'fresh',true,'id',v_id,'state','reserved');
end $$;

create function public.opportunity_budget_settle(p_id uuid,p_cost bigint,p_receipt jsonb,p_data jsonb default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.opportunity_budget_reservations;
begin
 select * into r from public.opportunity_budget_reservations where id=p_id;
 if not found then return false; end if;
 perform 1 from public.opportunity_budget_months where organization_id=r.organization_id and period=r.period for update;
 select * into r from public.opportunity_budget_reservations where id=p_id for update;
 if r.state='settled' then return true; end if;
 if p_cost is null then
  update public.opportunity_budget_reservations set state='uncertain',receipt=p_receipt where id=p_id;
  if p_data is not null then insert into public.opportunity_ai_results(reservation_id,organization_id,data) values(p_id,r.organization_id,p_data) on conflict do nothing; end if;
  return true;
 end if;
 if p_cost<0 then raise exception 'OPPORTUNITY_BAD_COST'; end if;
 update public.opportunity_budget_months set reserved_micro_usd=reserved_micro_usd-r.held_micro_usd,spent_micro_usd=spent_micro_usd+p_cost
  where organization_id=r.organization_id and period=r.period;
 update public.opportunity_budget_reservations set state='settled',cost_micro_usd=p_cost,receipt=p_receipt where id=p_id;
 if p_data is not null then insert into public.opportunity_ai_results(reservation_id,organization_id,data) values(p_id,r.organization_id,p_data) on conflict do nothing; end if;
 return true;
end $$;

create function public.opportunity_claim_job() returns setof public.opportunity_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 select j.id into v_id from public.opportunity_jobs j where (j.state in ('queued','waiting') or (j.state='running' and j.lease_until<now()))
  and j.attempts<100 and (j.state<>'waiting' or j.updated_at<now()-interval '45 seconds')
  and exists(select 1 from public.organization_members m where m.organization_id=j.organization_id and m.user_id=j.requested_by
    and (m.role in ('admin','owner') or (j.opportunity_id is not null and public.opportunity_can_read(j.organization_id,j.requested_by,j.opportunity_id))))
 order by case j.kind when 'chat' then 0 when 'research' then 1 when 'criteria' then 2 else 3 end,j.updated_at,j.created_at for update skip locked limit 1;
 if v_id is null then return; end if;
 return query update public.opportunity_jobs set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now()
  where id=v_id returning *;
end $$;

do $$ declare t text; begin
 foreach t in array array['opportunity_company_context','opportunity_budget_months','opportunity_jobs','opportunity_budget_reservations','opportunity_ai_results','opportunity_evaluations'] loop
  execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
revoke all on function public.opportunity_budget_reserve(uuid,uuid,text,text,bigint,uuid),public.opportunity_budget_settle(uuid,bigint,jsonb,jsonb),public.opportunity_claim_job() from public,anon,authenticated;
grant execute on function public.opportunity_budget_reserve(uuid,uuid,text,text,bigint,uuid),public.opportunity_budget_settle(uuid,bigint,jsonb,jsonb),public.opportunity_claim_job() to service_role;
create table public.opportunity_source_snapshots (
 job_id uuid primary key references public.opportunity_jobs(id) on delete cascade, organization_id uuid not null references public.organizations(id),
 candidates jsonb not null check(pg_column_size(candidates)<=8388608), created_at timestamptz not null default now()
);
alter table public.opportunity_source_snapshots enable row level security;
revoke all on public.opportunity_source_snapshots from public,anon,authenticated;
grant all on public.opportunity_source_snapshots to service_role;
notify pgrst,'reload schema';
