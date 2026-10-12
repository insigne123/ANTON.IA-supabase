-- Internal parallel search. USD amounts are integer microdollars, never app credits.
-- No browser grants. A reserved/uncertain start is not leased for another paid POST.
create table public.microworlds_search_budgets (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period date not null,
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  spent_micro_usd bigint not null default 0 check (spent_micro_usd >= 0),
  primary key (organization_id, period),
  check (period = date_trunc('month', period::timestamp)::date)
);
create table public.microworlds_search_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  company_domain text not null check (length(company_domain) between 3 and 253),
  criteria jsonb not null check (jsonb_typeof(criteria) = 'object'),
  period date not null,
  status text not null default 'queued' check (status in ('queued','submitting','running','completed','failed','unknown')),
  claim_token uuid,
  lease_until timestamptz,
  provider_run_id text unique,
  reserved_micro_usd bigint not null default 1500000 check (reserved_micro_usd between 0 and 1500000),
  billed_micro_usd bigint check (billed_micro_usd >= 0),
  fetched integer not null default 0 check (fetched between 0 and 100),
  error_code text check (length(error_code) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  check (expires_at > created_at and expires_at <= created_at + interval '31 days')
);
create index microworlds_jobs_fresh on public.microworlds_search_jobs (organization_id, fingerprint, created_at desc);
create index microworlds_jobs_queue on public.microworlds_search_jobs (status, lease_until, created_at);
create table public.microworlds_contact_cache (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_key text not null check (contact_key ~ '^[0-9a-f]{64}$'),
  job_id uuid not null references public.microworlds_search_jobs(id) on delete cascade,
  company_domain text not null,
  profile_hash text check (profile_hash ~ '^[0-9a-f]{64}$'),
  full_name_hash text check (full_name_hash ~ '^[0-9a-f]{64}$'),
  email_subject_hash text check (email_subject_hash ~ '^[0-9a-f]{64}$'),
  contact_encrypted text not null check (contact_encrypted like 'enc:v1.%' and length(contact_encrypted) <= 16000),
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (organization_id, contact_key),
  check (expires_at > observed_at and expires_at <= observed_at + interval '31 days')
);
create index microworlds_cache_profile on public.microworlds_contact_cache (organization_id, company_domain, profile_hash, expires_at);
create index microworlds_cache_name on public.microworlds_contact_cache (organization_id, company_domain, full_name_hash, expires_at);
create index microworlds_cache_subject on public.microworlds_contact_cache (email_subject_hash);
-- Only provider observations, not browser-submitted checkpoint snapshots, vouch for an Apollo identity.
create table public.apollo_search_observations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  apollo_person_id text not null check (length(apollo_person_id) between 1 and 255),
  company_domain text not null,
  identity jsonb not null check (jsonb_typeof(identity) = 'object'),
  identity_confirmed boolean not null default false,
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  primary key (organization_id, user_id, apollo_person_id),
  check (expires_at > observed_at and expires_at <= observed_at + interval '31 days')
);
alter table public.microworlds_search_budgets enable row level security;
alter table public.microworlds_search_jobs enable row level security;
alter table public.microworlds_contact_cache enable row level security;
alter table public.apollo_search_observations enable row level security;
revoke all on public.microworlds_search_budgets, public.microworlds_search_jobs,
  public.microworlds_contact_cache, public.apollo_search_observations from public, anon, authenticated;
grant all on public.microworlds_search_budgets, public.microworlds_search_jobs,
  public.microworlds_contact_cache, public.apollo_search_observations to service_role;

create function public.record_apollo_search_observations_v1(p_org uuid,p_user uuid,p_domain text,p_rows jsonb,p_confirmed boolean default false)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_count integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 or p_confirmed is null
    or not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user)
    then raise exception 'invalid observation scope'; end if;
  insert into public.apollo_search_observations(organization_id,user_id,apollo_person_id,company_domain,identity,identity_confirmed,observed_at,expires_at)
    select p_org,p_user,r->>'id',p_domain,jsonb_build_object('fullName',r->>'fullName','linkedinUrl',r->>'linkedinUrl','title',r->>'title'),p_confirmed,now(),now()+interval '30 days'
    from jsonb_array_elements(p_rows) r
    on conflict(organization_id,user_id,apollo_person_id) do update set company_domain=excluded.company_domain,
      identity=case when apollo_search_observations.identity_confirmed and apollo_search_observations.expires_at>now() and not p_confirmed
        then excluded.identity||jsonb_build_object('fullName',apollo_search_observations.identity->>'fullName','linkedinUrl',apollo_search_observations.identity->>'linkedinUrl')
        else excluded.identity end,
      identity_confirmed=excluded.identity_confirmed or apollo_search_observations.identity_confirmed and apollo_search_observations.expires_at>now(),
      observed_at=excluded.observed_at,expires_at=excluded.expires_at;
  get diagnostics v_count=row_count; return v_count;
end; $$;

create function public.enqueue_microworlds_search_v1(p_org uuid, p_user uuid, p_fingerprint text, p_domain text, p_criteria jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.microworlds_search_jobs%rowtype; v_period date := date_trunc('month', timezone('UTC',now()))::date;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_domain is null
    or length(p_domain) not between 3 and 253 or jsonb_typeof(p_criteria) is distinct from 'object'
    or not exists (select 1 from public.organization_members where organization_id=p_org and user_id=p_user)
    then raise exception 'invalid search scope' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('microworlds:'||p_org::text||':'||p_fingerprint,0));
  select * into v_job from public.microworlds_search_jobs where organization_id=p_org and fingerprint=p_fingerprint
    and expires_at>now() order by created_at desc limit 1;
  if found then return jsonb_build_object('id',v_job.id,'status',v_job.status,'reused',true); end if;
  insert into public.microworlds_search_budgets(organization_id,period) values(p_org,v_period) on conflict do nothing;
  update public.microworlds_search_budgets set reserved_micro_usd=reserved_micro_usd+1500000
    where organization_id=p_org and period=v_period and spent_micro_usd+reserved_micro_usd+1500000<=20000000;
  if not found then return jsonb_build_object('status','budget_exhausted'); end if;
  insert into public.microworlds_search_jobs(organization_id,requested_by,fingerprint,company_domain,criteria,period)
    values(p_org,p_user,p_fingerprint,p_domain,p_criteria,v_period) returning * into v_job;
  return jsonb_build_object('id',v_job.id,'status','queued','reused',false);
end; $$;

create function public.claim_microworlds_search_v1(p_id uuid default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.microworlds_search_jobs%rowtype; v_token uuid := gen_random_uuid();
  v_period date := date_trunc('month',timezone('UTC',now()))::date;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  select * into v_job from public.microworlds_search_jobs where (p_id is null or id=p_id) and expires_at>now()
    and (lease_until is null or lease_until<now())
    and (status='queued' or status in ('running','unknown') and provider_run_id is not null)
    order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  if v_job.status='queued' and v_job.period<>v_period then
    -- The limit belongs to the month of the paid start, not an older queued request.
    update public.microworlds_search_budgets set reserved_micro_usd=reserved_micro_usd-v_job.reserved_micro_usd
      where organization_id=v_job.organization_id and period=v_job.period;
    insert into public.microworlds_search_budgets(organization_id,period) values(v_job.organization_id,v_period) on conflict do nothing;
    update public.microworlds_search_budgets set reserved_micro_usd=reserved_micro_usd+v_job.reserved_micro_usd
      where organization_id=v_job.organization_id and period=v_period
      and reserved_micro_usd+spent_micro_usd+v_job.reserved_micro_usd<=20000000;
    if not found then
      update public.microworlds_search_jobs set status='failed',reserved_micro_usd=0,billed_micro_usd=0,error_code='MIRROR_MONTH_BUDGET_EXHAUSTED',updated_at=now() where id=v_job.id;
      return null;
    end if;
    update public.microworlds_search_jobs set period=v_period where id=v_job.id returning * into v_job;
  end if;
  update public.microworlds_search_jobs set claim_token=v_token,lease_until=now()+interval '90 seconds',
    status=case when status='queued' then 'submitting' else 'running' end,updated_at=now()
    where id=v_job.id returning * into v_job;
  return to_jsonb(v_job);
end; $$;

create function public.record_microworlds_run_v1(p_id uuid,p_claim uuid,p_run text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if p_run is null or length(p_run) not between 1 and 100 then raise exception 'invalid provider run'; end if;
  update public.microworlds_search_jobs set provider_run_id=p_run,status='running',updated_at=now()
    where id=p_id and claim_token=p_claim and status='submitting' and provider_run_id is null;
  return found;
end; $$;

create function public.finish_microworlds_search_v1(p_id uuid,p_claim uuid,p_status text,p_billed bigint,p_fetched integer,p_error text default null)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.microworlds_search_jobs%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if p_status not in ('completed','failed','unknown') or p_fetched not between 0 and 100 or p_billed<0
    or (p_billed is null and p_status<>'unknown') then raise exception 'invalid receipt'; end if;
  select * into v_job from public.microworlds_search_jobs where id=p_id and claim_token=p_claim
    and status in ('submitting','running') for update;
  if not found then return false; end if;
  -- Unknown costs retain the full reservation, including past-month buckets.
  if p_billed is not null then
    update public.microworlds_search_budgets set reserved_micro_usd=reserved_micro_usd-v_job.reserved_micro_usd,
      spent_micro_usd=spent_micro_usd+p_billed where organization_id=v_job.organization_id and period=v_job.period;
  end if;
  update public.microworlds_search_jobs set status=p_status,billed_micro_usd=p_billed,fetched=p_fetched,
    reserved_micro_usd=case when p_billed is null then reserved_micro_usd else 0 end,error_code=left(p_error,100),
    lease_until=null,claim_token=null,updated_at=now() where id=p_id;
  return true;
end; $$;

create function public.publish_microworlds_contacts_v1(p_id uuid,p_claim uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.microworlds_search_jobs%rowtype; v_count integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 then raise exception 'invalid cache batch'; end if;
  select * into v_job from public.microworlds_search_jobs where id=p_id and claim_token=p_claim
    and status='running' and lease_until>now() for update;
  if not found then raise exception 'cache lease lost'; end if;
  insert into public.microworlds_contact_cache(organization_id,contact_key,job_id,company_domain,profile_hash,full_name_hash,
    email_subject_hash,contact_encrypted,observed_at,expires_at)
    select v_job.organization_id,r->>'contact_key',v_job.id,v_job.company_domain,r->>'profile_hash',r->>'full_name_hash',
      r->>'email_subject_hash',r->>'contact_encrypted',now(),now()+interval '30 days'
    from jsonb_array_elements(p_rows) r
    where not exists(select 1 from public.unsubscribed_emails e where (e.organization_id is null or e.organization_id=v_job.organization_id)
      and encode(extensions.digest(convert_to(lower(trim(e.email)),'UTF8'),'sha256'),'hex')=r->>'email_subject_hash')
    on conflict(organization_id,contact_key) do update set job_id=excluded.job_id,company_domain=excluded.company_domain,
      profile_hash=excluded.profile_hash,full_name_hash=excluded.full_name_hash,email_subject_hash=excluded.email_subject_hash,
      contact_encrypted=excluded.contact_encrypted,observed_at=excluded.observed_at,expires_at=excluded.expires_at
    where microworlds_contact_cache.observed_at<=excluded.observed_at;
  get diagnostics v_count=row_count; return v_count;
end; $$;

create function public.purge_suppressed_microworlds_cache_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  delete from public.microworlds_contact_cache where email_subject_hash=
    encode(extensions.digest(convert_to(lower(trim(new.email)),'UTF8'),'sha256'),'hex')
    and (new.organization_id is null or organization_id=new.organization_id);
  return new;
end; $$;
create trigger purge_suppressed_microworlds_cache after insert or update on public.unsubscribed_emails
  for each row execute function public.purge_suppressed_microworlds_cache_v1();
revoke all on function public.purge_suppressed_microworlds_cache_v1() from public,anon,authenticated;

create function public.maintain_microworlds_jobs_v1()
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.microworlds_search_jobs%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  -- Submitting jobs are fenced permanently until receipt recovery: never resend a paid POST.
  update public.microworlds_search_jobs set status='unknown',error_code='MIRROR_START_UNKNOWN',claim_token=null,lease_until=null,updated_at=now()
    where status='submitting' and lease_until<now()-interval '2 minutes';
  for v_job in select * from public.microworlds_search_jobs where status='queued' and created_at<now()-interval '1 hour' for update skip locked loop
    update public.microworlds_search_budgets set reserved_micro_usd=reserved_micro_usd-v_job.reserved_micro_usd
      where organization_id=v_job.organization_id and period=v_job.period;
    update public.microworlds_search_jobs set status='failed',reserved_micro_usd=0,billed_micro_usd=0,error_code='MIRROR_QUEUE_EXPIRED',updated_at=now() where id=v_job.id;
  end loop;
  delete from public.microworlds_contact_cache where expires_at<now();
  delete from public.apollo_search_observations where expires_at<now();
  if to_regclass('public.hybrid_enrichment_items') is not null then
    -- Keep billing/reference metadata but remove expired encrypted contact plans.
    execute 'update public.hybrid_enrichment_items set plan_encrypted=''enc:v1.expired'',state=case when state=''planned'' then ''cancelled'' else state end where expires_at<now() and plan_encrypted<>''enc:v1.expired''';
  end if;
end; $$;

revoke all on function public.enqueue_microworlds_search_v1(uuid,uuid,text,text,jsonb),
  public.record_apollo_search_observations_v1(uuid,uuid,text,jsonb,boolean),
  public.claim_microworlds_search_v1(uuid), public.record_microworlds_run_v1(uuid,uuid,text),
  public.finish_microworlds_search_v1(uuid,uuid,text,bigint,integer,text),public.publish_microworlds_contacts_v1(uuid,uuid,jsonb),
  public.maintain_microworlds_jobs_v1() from public,anon,authenticated;
grant execute on function public.enqueue_microworlds_search_v1(uuid,uuid,text,text,jsonb),
  public.record_apollo_search_observations_v1(uuid,uuid,text,jsonb,boolean),
  public.claim_microworlds_search_v1(uuid), public.record_microworlds_run_v1(uuid,uuid,text),
  public.finish_microworlds_search_v1(uuid,uuid,text,bigint,integer,text),public.publish_microworlds_contacts_v1(uuid,uuid,jsonb),
  public.maintain_microworlds_jobs_v1() to service_role;
