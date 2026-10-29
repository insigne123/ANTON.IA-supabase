-- Finding the email ourselves when Apollo identifies a person but has none (src/lib/server/email-finder). One row per
-- lead: whether it is waiting, what was found and how many Reoon checks it cost. No addresses are kept here: a found
-- address is written on the lead itself, which the privacy flows already cover.
create table if not exists public.email_finder_attempts (
  id uuid primary key default gen_random_uuid(),
  target_table text not null check (target_table in ('enriched_leads', 'people_search_leads')),
  target_lead_id text not null check (char_length(target_lead_id) between 1 and 255),
  organization_id uuid not null,
  user_id uuid not null,
  status text not null default 'retry' check (status in (
    'retry', 'processing', 'found', 'guessed', 'catch_all', 'not_found', 'no_domain', 'no_name', 'no_mx', 'suppressed',
    'lead_changed', 'failed'
  )),
  domain text check (domain is null or char_length(domain) <= 253),
  email_status text check (email_status is null or email_status in ('verified', 'extrapolated')),
  pattern text check (pattern is null or char_length(pattern) <= 40),
  verifications integer not null default 0 check (verifications between 0 and 200),
  last_result text check (last_result is null or char_length(last_result) <= 40),
  attempts integer not null default 0 check (attempts between 0 and 20),
  claimed_at timestamptz,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_finder_attempts_target_key unique (target_table, target_lead_id)
);

create index if not exists email_finder_attempts_queue_idx
  on public.email_finder_attempts (next_attempt_at)
  where status in ('retry', 'processing');
-- "This domain accepts any address": checked before spending Reoon credits on another person of the same company.
create index if not exists email_finder_attempts_domain_idx
  on public.email_finder_attempts (domain, updated_at)
  where status in ('catch_all', 'guessed');

alter table public.email_finder_attempts enable row level security;
-- Server only: no client policy.
revoke all on table public.email_finder_attempts from public, anon, authenticated;
grant select, insert, update on table public.email_finder_attempts to service_role;

-- Queues every lead that asked Apollo for the email since p_since, finished, and still has none, then claims up to
-- p_limit of them. A claim older than p_claim_before is treated as abandoned and taken again.
create or replace function public.claim_email_finder_candidates_v1(
  p_limit integer,
  p_since timestamptz,
  p_claim_before timestamptz
)
returns table (
  attempt_id uuid,
  claimed_at timestamptz,
  target_table text,
  target_lead_id text,
  organization_id uuid,
  user_id uuid,
  full_name text,
  first_name text,
  last_name text,
  lead_domain text,
  website_domain text,
  company_domain text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_now timestamptz := clock_timestamp();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50 or p_since is null or p_claim_before is null then
    raise exception 'invalid email finder claim' using errcode = '22023';
  end if;

  insert into public.email_finder_attempts (target_table, target_lead_id, organization_id, user_id, status, next_attempt_at)
  select distinct on (c.target_table, c.target_lead_id)
    c.target_table, c.target_lead_id, c.organization_id, c.user_id, 'retry', v_now
  from public.apollo_enrichment_callbacks c
  where c.created_at >= p_since
    and c.reveal_email
    and c.terminal_state in ('no_data', 'succeeded')
    and c.target_table in ('enriched_leads', 'people_search_leads')
    and c.organization_id is not null
    and c.user_id is not null
    and not exists (
      select 1 from public.email_finder_attempts a
      where a.target_table = c.target_table and a.target_lead_id = c.target_lead_id
    )
    and (
      (c.target_table = 'enriched_leads' and exists (
        select 1 from public.enriched_leads l
        where l.id = c.target_lead_id and l.user_id = c.user_id and l.organization_id = c.organization_id
          and nullif(trim(coalesce(l.email, '')), '') is null and coalesce(l.enrichment_status, '') <> 'suppressed'
      ))
      or (c.target_table = 'people_search_leads' and exists (
        select 1 from public.people_search_leads l
        where l.id = c.target_lead_id and l.user_id = c.user_id and l.organization_id = c.organization_id::text
          and nullif(trim(coalesce(l.email, '')), '') is null and coalesce(l.enrichment_status, '') <> 'suppressed'
      ))
    )
  order by c.target_table, c.target_lead_id, c.created_at desc
  on conflict (target_table, target_lead_id) do nothing;

  return query
  with picked as (
    select a.id
    from public.email_finder_attempts a
    where (a.status = 'retry' and a.next_attempt_at <= v_now)
       or (a.status = 'processing' and a.claimed_at < p_claim_before)
    order by a.next_attempt_at, a.created_at
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.email_finder_attempts a
    set status = 'processing', claimed_at = v_now, attempts = a.attempts + 1, updated_at = v_now
    from picked
    where a.id = picked.id
    returning a.id, a.claimed_at, a.target_table, a.target_lead_id, a.organization_id, a.user_id
  ), leads as (
    select cl.*,
      coalesce(el.full_name, pl.name) as lead_full_name,
      coalesce(el.first_name, pl.first_name) as lead_first_name,
      coalesce(el.last_name, pl.last_name) as lead_last_name,
      coalesce(el.organization_domain, pl.organization_domain) as lead_domain,
      pl.organization_website as website_domain,
      lower(trim(coalesce(nullif(el.organization_name, ''), nullif(el.company_name, ''),
        nullif(pl.organization_name, ''), pl.org_name, ''))) as company_key
    from claimed cl
    left join public.enriched_leads el
      on cl.target_table = 'enriched_leads' and el.id = cl.target_lead_id
    left join public.people_search_leads pl
      on cl.target_table = 'people_search_leads' and pl.id = cl.target_lead_id
  )
  select l.id, l.claimed_at, l.target_table, l.target_lead_id, l.organization_id, l.user_id,
    l.lead_full_name, l.lead_first_name, l.lead_last_name, l.lead_domain, l.website_domain, same_company.domain
  from leads l
  -- The lead has no domain: take the one most used by other leads of the same company name.
  left join lateral (
    select x.domain
    from (
      select lower(e.organization_domain) as domain
      from public.enriched_leads e
      where l.company_key <> '' and coalesce(e.organization_domain, '') <> ''
        and lower(trim(coalesce(nullif(e.organization_name, ''), e.company_name, ''))) = l.company_key
      union all
      select lower(p.organization_domain)
      from public.people_search_leads p
      where l.company_key <> '' and coalesce(p.organization_domain, '') <> ''
        and lower(trim(coalesce(nullif(p.organization_name, ''), p.org_name, ''))) = l.company_key
    ) x
    group by x.domain
    order by count(*) desc, x.domain
    limit 1
  ) same_company on coalesce(l.lead_domain, '') = '';
end;
$$;

-- Saves the outcome of one claimed lead. A found address goes on the lead only while it still has no email; the
-- suppression trigger on the lead tables still applies. 'release' gives the claim back without counting an attempt.
create or replace function public.complete_email_finder_attempt_v1(
  p_attempt_id uuid,
  p_claimed_at timestamptz,
  p_status text,
  p_domain text,
  p_email text,
  p_email_status text,
  p_pattern text,
  p_verifications integer,
  p_last_result text,
  p_retry_after_seconds integer
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_attempt public.email_finder_attempts%rowtype;
  v_status text := p_status;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_domain text := nullif(lower(trim(coalesce(p_domain, ''))), '');
  v_lead_status text;
  v_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_attempt_id is null or p_claimed_at is null
    or p_status not in ('found', 'guessed', 'catch_all', 'not_found', 'no_domain', 'no_name', 'no_mx', 'suppressed', 'retry', 'release')
    or coalesce(p_verifications, 0) not between 0 and 20
    or coalesce(p_retry_after_seconds, 0) not between 0 and 604800
    or char_length(coalesce(v_domain, '')) > 253
    or char_length(coalesce(p_pattern, '')) > 40 then
    raise exception 'invalid email finder result' using errcode = '22023';
  end if;
  if p_status in ('found', 'guessed') and (
    char_length(v_email) > 320
    or v_email !~ '^[a-z0-9]+([._-][a-z0-9]+)*@[a-z0-9-]+(\.[a-z0-9-]+)+$'
    or split_part(v_email, '@', 2) is distinct from v_domain
    or coalesce(p_email_status, '') not in ('verified', 'extrapolated')
  ) then
    raise exception 'invalid email finder address' using errcode = '22023';
  end if;

  select * into v_attempt from public.email_finder_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'processing' or v_attempt.claimed_at is distinct from p_claimed_at then
    return 'stale';
  end if;

  if v_status in ('found', 'guessed') then
    if v_attempt.target_table = 'enriched_leads' then
      update public.enriched_leads l
      set email = v_email, email_status = p_email_status, updated_at = v_now
      where l.id = v_attempt.target_lead_id and l.user_id = v_attempt.user_id and l.organization_id = v_attempt.organization_id
        and nullif(trim(coalesce(l.email, '')), '') is null and coalesce(l.enrichment_status, '') <> 'suppressed'
      returning l.enrichment_status into v_lead_status;
    else
      update public.people_search_leads l
      set email = v_email, email_status = p_email_status, updated_at = v_now
      where l.id = v_attempt.target_lead_id and l.user_id = v_attempt.user_id
        and l.organization_id = v_attempt.organization_id::text
        and nullif(trim(coalesce(l.email, '')), '') is null and coalesce(l.enrichment_status, '') <> 'suppressed'
      returning l.enrichment_status into v_lead_status;
    end if;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      v_status := 'lead_changed';
    elsif v_lead_status = 'suppressed' then
      v_status := 'suppressed';
    end if;
  elsif v_status = 'retry' and v_attempt.attempts >= 3 then
    v_status := 'failed';
  end if;

  update public.email_finder_attempts a
  set status = case when v_status = 'release' then 'retry' else v_status end,
      attempts = case when v_status = 'release' then greatest(a.attempts - 1, 0) else a.attempts end,
      domain = coalesce(v_domain, a.domain),
      email_status = case when v_status in ('found', 'guessed') then p_email_status else null end,
      pattern = case when v_status in ('found', 'guessed') then p_pattern else null end,
      verifications = least(a.verifications + coalesce(p_verifications, 0), 200),
      last_result = left(nullif(trim(coalesce(p_last_result, '')), ''), 40),
      claimed_at = null,
      next_attempt_at = case when v_status in ('retry', 'release')
        then v_now + make_interval(secs => coalesce(p_retry_after_seconds, 0)) else null end,
      updated_at = v_now
  where a.id = p_attempt_id;

  return case when v_status = 'release' then 'retry' else v_status end;
end;
$$;

revoke all on function public.claim_email_finder_candidates_v1(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_email_finder_candidates_v1(integer, timestamptz, timestamptz) to service_role;
revoke all on function public.complete_email_finder_attempt_v1(uuid, timestamptz, text, text, text, text, text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.complete_email_finder_attempt_v1(uuid, timestamptz, text, text, text, text, text, integer, text, integer)
  to service_role;
