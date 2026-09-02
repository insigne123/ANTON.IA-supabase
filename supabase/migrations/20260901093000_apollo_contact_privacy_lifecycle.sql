-- Bring Apollo contact stores under the same privacy lock and subject lifecycle
-- as the messaging tables. Historical provider migrations remain untouched.

begin;

-- Keep deterministic subject references in a server-only table. Putting these
-- hashes on browser-readable lead rows would create an avoidable correlation
-- surface, while dropping the email on a suppressed insert would make the row
-- impossible to find for a later access or erasure request.
create table if not exists public.apollo_contact_subject_refs (
  target_table text not null,
  target_lead_id text not null,
  organization_id text,
  user_id uuid,
  email_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (target_table, target_lead_id, email_hash),
  constraint apollo_contact_subject_refs_target_table_check
    check (target_table in ('people_search_leads', 'enriched_leads', 'enriched_opportunities')),
  constraint apollo_contact_subject_refs_email_hash_check
    check (email_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists apollo_contact_subject_refs_email_hash_idx
  on public.apollo_contact_subject_refs (email_hash);

alter table public.apollo_contact_subject_refs enable row level security;
revoke all on table public.apollo_contact_subject_refs
  from public, anon, authenticated;
grant all on table public.apollo_contact_subject_refs to service_role;

create or replace function public.has_apollo_enrichment_email_suppression_v1(
  p_user_id uuid,
  p_organization_id uuid,
  p_emails text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_user_id is null or p_organization_id is null or p_emails is null
    or cardinality(p_emails) not between 1 and 25
    or array_position(p_emails, null) is not null
    or exists (
      select 1 from unnest(p_emails) email(value)
      where char_length(trim(email.value)) not between 1 and 320
    ) then
    raise exception 'invalid Apollo suppression lookup' using errcode = '22023';
  end if;

  return exists (
    select 1
    from public.unsubscribed_emails suppressed
    join unnest(p_emails) email(value)
      on lower(trim(suppressed.email)) = lower(trim(email.value))
    where (suppressed.user_id is null and suppressed.organization_id is null)
      or suppressed.user_id = p_user_id
      or suppressed.organization_id = p_organization_id
  );
end;
$$;

revoke all on function public.has_apollo_enrichment_email_suppression_v1(uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.has_apollo_enrichment_email_suppression_v1(uuid, uuid, text[])
  to service_role;

-- Keep the backfill and trigger installation as one write-free cutover.
lock table public.enriched_leads, public.enriched_opportunities, public.people_search_leads
  in share row exclusive mode;

insert into public.apollo_contact_subject_refs (
  target_table, target_lead_id, organization_id, user_id, email_hash
)
select
  'enriched_leads', el.id, el.organization_id::text, el.user_id,
  encode(extensions.digest(convert_to(lower(trim(el.email)), 'UTF8'), 'sha256'), 'hex')
from public.enriched_leads el
where nullif(trim(coalesce(el.email, '')), '') is not null
on conflict (target_table, target_lead_id, email_hash) do update
set organization_id = excluded.organization_id,
    user_id = excluded.user_id,
    updated_at = now();

insert into public.apollo_contact_subject_refs (
  target_table, target_lead_id, organization_id, user_id, email_hash
)
select
  'enriched_opportunities', eo.id::text, eo.organization_id::text, eo.user_id,
  encode(extensions.digest(convert_to(lower(trim(eo.email)), 'UTF8'), 'sha256'), 'hex')
from public.enriched_opportunities eo
where nullif(trim(coalesce(eo.email, '')), '') is not null
on conflict (target_table, target_lead_id, email_hash) do update
set organization_id = excluded.organization_id,
    user_id = excluded.user_id,
    updated_at = now();

insert into public.apollo_contact_subject_refs (
  target_table, target_lead_id, organization_id, user_id, email_hash
)
select
  'people_search_leads', psl.id, psl.organization_id, psl.user_id,
  encode(extensions.digest(convert_to(lower(trim(psl.email)), 'UTF8'), 'sha256'), 'hex')
from public.people_search_leads psl
where nullif(trim(coalesce(psl.email, '')), '') is not null
on conflict (target_table, target_lead_id, email_hash) do update
set organization_id = excluded.organization_id,
    user_id = excluded.user_id,
    updated_at = now();

update public.apollo_enrichment_callbacks callback
set privacy_subject_hash = ref.email_hash,
    updated_at = now()
from public.apollo_contact_subject_refs ref
where ref.target_table = callback.target_table
  and ref.target_lead_id = callback.target_lead_id
  and callback.privacy_subject_hash is null;

create or replace function public.enforce_enrichment_contact_suppression_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_email text;
  v_subject_email text;
  v_email_hash text;
  v_suppressed boolean := false;
begin
  v_email := lower(trim(coalesce(new.email, '')));
  if tg_op = 'UPDATE' and lower(coalesce(old.enrichment_status, '')) = 'suppressed' then
    new.email := old.email;
    new.email_status := old.email_status;
    new.phone_numbers := old.phone_numbers;
    new.primary_phone := old.primary_phone;
    new.title := old.title;
    new.linkedin_url := old.linkedin_url;
    new.source_provider := old.source_provider;
    new.source_provider_id := old.source_provider_id;
    if tg_table_name = 'people_search_leads' then
      new.name := old.name;
      new.first_name := old.first_name;
      new.last_name := old.last_name;
      new.apollo_person_id := old.apollo_person_id;
      new.organization_name := old.organization_name;
      new.organization_domain := old.organization_domain;
      new.organization_industry := old.organization_industry;
      new.organization_size := old.organization_size;
      new.city := old.city;
      new.state := old.state;
      new.country := old.country;
      new.headline := old.headline;
      new.photo_url := old.photo_url;
      new.seniority := old.seniority;
      new.departments := old.departments;
    elsif tg_table_name = 'enriched_leads' then
      new.full_name := old.full_name;
      new.company_name := old.company_name;
      new.organization_domain := old.organization_domain;
      new.organization_industry := old.organization_industry;
      new.organization_size := old.organization_size;
      new.city := old.city;
      new.state := old.state;
      new.country := old.country;
      new.headline := old.headline;
      new.photo_url := old.photo_url;
      new.seniority := old.seniority;
      new.departments := old.departments;
      new.data := old.data;
    else
      new.full_name := old.full_name;
      new.company_name := old.company_name;
      new.data := old.data;
    end if;
    new.enrichment_status := 'suppressed';
    return new;
  end if;
  if v_email = '' then
    if tg_op = 'UPDATE' and nullif(trim(coalesce(old.email, '')), '') is not null then
      v_subject_email := lower(trim(old.email));
      v_email_hash := encode(
        extensions.digest(convert_to(v_subject_email, 'UTF8'), 'sha256'),
        'hex'
      );
      insert into public.apollo_contact_subject_refs (
        target_table, target_lead_id, organization_id, user_id, email_hash
      ) values (
        tg_table_name, new.id::text, new.organization_id::text, new.user_id, v_email_hash
      )
      on conflict (target_table, target_lead_id, email_hash) do update
      set organization_id = excluded.organization_id,
          user_id = excluded.user_id,
          updated_at = now();
    end if;
    return new;
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0)) then
    -- The row is already locked by this write. Fail retryably rather than wait
    -- behind a privacy transaction that may need the same row.
    raise exception 'privacy deletion is in progress' using errcode = '40001';
  end if;

  select exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(coalesce(ue.email, ''))) = v_email
      and (
        (ue.user_id is null and ue.organization_id is null)
        or ue.user_id = new.user_id
        or ue.organization_id::text = new.organization_id::text
      )
  ) into v_suppressed;

  if v_suppressed then
    if tg_op = 'UPDATE' then
      new.email := old.email;
      new.email_status := old.email_status;
      new.phone_numbers := old.phone_numbers;
      new.primary_phone := old.primary_phone;
      new.title := old.title;
      new.linkedin_url := old.linkedin_url;
      new.source_provider := old.source_provider;
      new.source_provider_id := old.source_provider_id;
      if tg_table_name = 'people_search_leads' then
        new.name := old.name;
        new.first_name := old.first_name;
        new.last_name := old.last_name;
        new.apollo_person_id := old.apollo_person_id;
        new.organization_name := old.organization_name;
        new.organization_domain := old.organization_domain;
        new.organization_industry := old.organization_industry;
        new.organization_size := old.organization_size;
        new.city := old.city;
        new.state := old.state;
        new.country := old.country;
        new.headline := old.headline;
        new.photo_url := old.photo_url;
        new.seniority := old.seniority;
        new.departments := old.departments;
      elsif tg_table_name = 'enriched_leads' then
        new.full_name := old.full_name;
        new.company_name := old.company_name;
        new.organization_domain := old.organization_domain;
        new.organization_industry := old.organization_industry;
        new.organization_size := old.organization_size;
        new.city := old.city;
        new.state := old.state;
        new.country := old.country;
        new.headline := old.headline;
        new.photo_url := old.photo_url;
        new.seniority := old.seniority;
        new.departments := old.departments;
        new.data := old.data;
      else
        new.full_name := old.full_name;
        new.company_name := old.company_name;
        new.data := old.data;
      end if;
      v_subject_email := coalesce(nullif(lower(trim(coalesce(old.email, ''))), ''), v_email);
    else
      new.email := null;
      new.email_status := null;
      new.phone_numbers := null;
      new.primary_phone := null;
      new.title := null;
      new.linkedin_url := null;
      new.source_provider := null;
      new.source_provider_id := null;
      if tg_table_name = 'people_search_leads' then
        new.name := null;
        new.first_name := null;
        new.last_name := null;
        new.apollo_person_id := null;
        new.organization_name := null;
        new.organization_domain := null;
        new.organization_industry := null;
        new.organization_size := null;
        new.city := null;
        new.state := null;
        new.country := null;
        new.headline := null;
        new.photo_url := null;
        new.seniority := null;
        new.departments := null;
      elsif tg_table_name = 'enriched_leads' then
        new.full_name := null;
        new.company_name := null;
        new.organization_domain := null;
        new.organization_industry := null;
        new.organization_size := null;
        new.city := null;
        new.state := null;
        new.country := null;
        new.headline := null;
        new.photo_url := null;
        new.seniority := null;
        new.departments := null;
        new.data := '{}'::jsonb;
      else
        new.full_name := null;
        new.company_name := null;
        new.data := '{}'::jsonb;
      end if;
      v_subject_email := v_email;
    end if;
    new.enrichment_status := 'suppressed';
  else
    v_subject_email := lower(trim(coalesce(new.email, '')));
  end if;

  if v_subject_email = '' then
    return new;
  end if;

  v_email_hash := encode(
    extensions.digest(convert_to(v_subject_email, 'UTF8'), 'sha256'),
    'hex'
  );
  insert into public.apollo_contact_subject_refs (
    target_table,
    target_lead_id,
    organization_id,
    user_id,
    email_hash
  ) values (
    tg_table_name,
    new.id::text,
    new.organization_id::text,
    new.user_id,
    v_email_hash
  )
  on conflict (target_table, target_lead_id, email_hash) do update
  set organization_id = excluded.organization_id,
      user_id = excluded.user_id,
      updated_at = now();

  return new;
end;
$$;

revoke all on function public.enforce_enrichment_contact_suppression_v1()
  from public, anon, authenticated;

drop trigger if exists enforce_enriched_leads_contact_suppression
  on public.enriched_leads;
create trigger enforce_enriched_leads_contact_suppression
  before insert or update
  on public.enriched_leads
  for each row execute function public.enforce_enrichment_contact_suppression_v1();

drop trigger if exists enforce_enriched_opportunities_contact_suppression
  on public.enriched_opportunities;
create trigger enforce_enriched_opportunities_contact_suppression
  before insert or update
  on public.enriched_opportunities
  for each row execute function public.enforce_enrichment_contact_suppression_v1();

drop trigger if exists enforce_people_search_leads_contact_suppression
  on public.people_search_leads;
create trigger enforce_people_search_leads_contact_suppression
  before insert or update
  on public.people_search_leads
  for each row execute function public.enforce_enrichment_contact_suppression_v1();

create or replace function public.lookup_research_messaging_subject_v1(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with subject as (
    select
      lower(trim(coalesce(p_email, ''))) as email,
      encode(
        extensions.digest(convert_to(lower(trim(coalesce(p_email, ''))), 'UTF8'), 'sha256'),
        'hex'
      ) as email_hash
  ), core as (
    select public.lookup_research_messaging_subject_core_v1(p_email) as payload
  )
  select core.payload
    || jsonb_build_object('campaignV2', public.lookup_campaign_v2_subject_v2(p_email))
    || jsonb_build_object(
      'enrichedLeads', coalesce((
        select jsonb_agg(to_jsonb(el) order by el.updated_at desc nulls last)
        from public.enriched_leads el
        cross join subject
        where lower(trim(coalesce(el.email, ''))) = subject.email
          or exists (
            select 1
            from public.apollo_contact_subject_refs ref
            where ref.target_table = 'enriched_leads'
              and ref.target_lead_id = el.id
              and ref.email_hash = subject.email_hash
          )
      ), '[]'::jsonb),
      'enrichedOpportunities', coalesce((
        select jsonb_agg(to_jsonb(eo) order by eo.id)
        from public.enriched_opportunities eo
        cross join subject
        where lower(trim(coalesce(eo.email, ''))) = subject.email
          or exists (
            select 1
            from public.apollo_contact_subject_refs ref
            where ref.target_table = 'enriched_opportunities'
              and ref.target_lead_id = eo.id::text
              and ref.email_hash = subject.email_hash
          )
      ), '[]'::jsonb),
      'peopleSearchLeads', coalesce((
        select jsonb_agg(to_jsonb(psl) order by psl.id)
        from public.people_search_leads psl
        cross join subject
        where lower(trim(coalesce(psl.email, ''))) = subject.email
          or exists (
            select 1
            from public.apollo_contact_subject_refs ref
            where ref.target_table = 'people_search_leads'
              and ref.target_lead_id = psl.id
              and ref.email_hash = subject.email_hash
          )
      ), '[]'::jsonb),
      'apolloEnrichmentCallbacks', coalesce((
        select jsonb_agg(
          to_jsonb(callback) - 'token_hash'
          order by callback.created_at desc
        )
        from public.apollo_enrichment_callbacks callback
        cross join subject
        where callback.privacy_subject_hash = subject.email_hash
          or exists (
            select 1
            from public.apollo_contact_subject_refs ref
            where ref.target_table = callback.target_table
              and ref.target_lead_id = callback.target_lead_id
              and ref.email_hash = subject.email_hash
          )
      ), '[]'::jsonb)
    )
  from core;
$$;

create or replace function public.apply_privacy_suppression_v2(
  p_email text,
  p_reason text default 'privacy_request_block'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'privacy_request_block');
  v_email_hash text;
  v_updated_contacted integer := 0;
  v_updated_leads integer := 0;
  v_updated_enriched_leads integer := 0;
  v_updated_enriched_opportunities integer := 0;
  v_updated_people_search_leads integer := 0;
  v_cancelled_callbacks integer := 0;
  v_cancelled_in_operation integer := 0;
  v_safety_stop jsonb;
  v_operation record;
  v_locked_operation public.antonia_quota_operations%rowtype;
  v_callback record;
  v_callback_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));
  v_email_hash := encode(
    extensions.digest(convert_to(v_email, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.unsubscribed_emails (email, reason)
  select v_email, v_reason
  where not exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(ue.email)) = v_email
      and ue.user_id is null
      and ue.organization_id is null
  )
  on conflict do nothing;

  v_safety_stop := public.safety_stop_campaign_recipient_v2(v_email, 'recipient_suppressed');

  -- Lock quota before callbacks, matching the provider-boundary transition.
  -- A claimed operation has not crossed Apollo and is cancelled as a whole;
  -- submitted operations keep their paid quota and settle when all targets end.
  for v_operation in
    select distinct
      callback.organization_id,
      callback.user_id,
      callback.quota_resource,
      callback.operation_id
    from public.apollo_enrichment_callbacks callback
    where callback.privacy_subject_hash = v_email_hash
      or exists (
        select 1
        from public.apollo_contact_subject_refs ref
        where ref.target_table = callback.target_table
          and ref.target_lead_id = callback.target_lead_id
          and ref.email_hash = v_email_hash
      )
  loop
    select * into v_locked_operation
    from public.antonia_quota_operations operation
    where operation.organization_id = v_operation.organization_id
      and operation.user_id = v_operation.user_id
      and operation.resource = v_operation.quota_resource
      and operation.operation_id = v_operation.operation_id
      and operation.status in ('claimed', 'submitted')
    for update;

    if found and v_locked_operation.status = 'claimed' then
      v_cancelled_in_operation := 0;
      for v_callback in
        select callback.id
        from public.apollo_enrichment_callbacks callback
        where callback.organization_id = v_operation.organization_id
          and callback.user_id = v_operation.user_id
          and callback.quota_resource = v_operation.quota_resource
          and callback.operation_id = v_operation.operation_id
          and callback.status <> 'terminal'
      loop
        v_callback_result := public.settle_apollo_enrichment_callback_v1(
          v_callback.id,
          'cancelled',
          'privacy_suppressed'
        );
        if coalesce(v_callback_result ->> 'outcome', '') in ('settled', 'target_not_found') then
          v_cancelled_in_operation := v_cancelled_in_operation + 1;
        end if;
      end loop;
      v_cancelled_callbacks := v_cancelled_callbacks + v_cancelled_in_operation;
      if not public.release_antonia_quota_operation_v1(
        v_operation.organization_id,
        v_operation.user_id,
        v_operation.quota_resource,
        v_operation.operation_id,
        v_locked_operation.claim_token
      ) then
        raise exception 'Apollo quota release lost its claim during privacy suppression' using errcode = '55000';
      end if;
    end if;
  end loop;

  with updated as (
    update public.apollo_enrichment_callbacks callback
    set status = case when callback.status = 'terminal' then callback.status else 'terminal' end,
        terminal_state = case when callback.status = 'terminal' then callback.terminal_state else 'cancelled' end,
        terminal_at = case when callback.status = 'terminal' then callback.terminal_at else now() end,
        last_error_code = case when callback.status = 'terminal' then callback.last_error_code else 'privacy_suppressed' end,
        updated_at = now()
    where callback.status <> 'terminal'
      and (
        callback.privacy_subject_hash = v_email_hash
        or exists (
          select 1
          from public.apollo_contact_subject_refs ref
          where ref.target_table = callback.target_table
            and ref.target_lead_id = callback.target_lead_id
            and ref.email_hash = v_email_hash
        )
      )
    returning id
  ) select v_cancelled_callbacks + count(*) into v_cancelled_callbacks from updated;

  for v_callback in
    select callback.id
    from public.apollo_enrichment_callbacks callback
    where callback.privacy_subject_hash = v_email_hash
      or exists (
        select 1
        from public.apollo_contact_subject_refs ref
        where ref.target_table = callback.target_table
          and ref.target_lead_id = callback.target_lead_id
          and ref.email_hash = v_email_hash
      )
  loop
    perform public.settle_apollo_enrichment_quota_if_ready_v1(v_callback.id);
  end loop;

  with updated as (
    update public.contacted_leads
    set campaign_followup_allowed = false,
        campaign_followup_reason = v_reason,
        evaluation_status = 'do_not_contact',
        last_update_at = now()
    where lower(trim(coalesce(email, ''))) = v_email
    returning id
  ) select count(*) into v_updated_contacted from updated;

  with updated as (
    update public.leads
    set status = 'do_not_contact'
    where lower(trim(coalesce(email, ''))) = v_email
    returning id
  ) select count(*) into v_updated_leads from updated;

  with updated as (
    update public.enriched_leads target
    set enrichment_status = 'suppressed', updated_at = now()
    where lower(trim(coalesce(target.email, ''))) = v_email
      or exists (
        select 1
        from public.apollo_contact_subject_refs ref
        where ref.target_table = 'enriched_leads'
          and ref.target_lead_id = target.id
          and ref.email_hash = v_email_hash
      )
    returning target.id
  ) select count(*) into v_updated_enriched_leads from updated;

  with updated as (
    update public.enriched_opportunities
    set enrichment_status = 'suppressed', updated_at = now()
    where lower(trim(coalesce(email, ''))) = v_email
      or exists (
        select 1
        from public.apollo_contact_subject_refs ref
        where ref.target_table = 'enriched_opportunities'
          and ref.target_lead_id = enriched_opportunities.id::text
          and ref.email_hash = v_email_hash
      )
    returning id
  ) select count(*) into v_updated_enriched_opportunities from updated;

  with updated as (
    update public.people_search_leads
    set enrichment_status = 'suppressed', updated_at = now()
    where lower(trim(coalesce(email, ''))) = v_email
      or exists (
        select 1
        from public.apollo_contact_subject_refs ref
        where ref.target_table = 'people_search_leads'
          and ref.target_lead_id = people_search_leads.id
          and ref.email_hash = v_email_hash
      )
    returning id
  ) select count(*) into v_updated_people_search_leads from updated;

  -- Completed idempotency responses are durable replay records. Strip contact
  -- fields there as well so an old operation key cannot bypass suppression.
  update public.antonia_quota_operations operation
  set response_payload = jsonb_set(
        operation.response_payload,
        '{enriched}',
        (
          select coalesce(jsonb_agg(
            case
              when lower(trim(coalesce(item.value ->> 'email', ''))) = v_email then
                jsonb_strip_nulls(jsonb_build_object(
                  'id', item.value -> 'id',
                  'enrichmentStatus', item.value -> 'enrichmentStatus'
                ))
              else item.value
            end
          ), '[]'::jsonb)
          from jsonb_array_elements(operation.response_payload -> 'enriched') item(value)
        ),
        true
      ),
      updated_at = now()
  where jsonb_typeof(operation.response_payload -> 'enriched') = 'array'
    and exists (
      select 1
      from jsonb_array_elements(operation.response_payload -> 'enriched') item(value)
      where lower(trim(coalesce(item.value ->> 'email', ''))) = v_email
    );

  return jsonb_build_object(
    'email', v_email,
    'blocked', true,
    'updatedContactedCount', v_updated_contacted,
    'updatedLeadsCount', v_updated_leads,
    'updatedEnrichedLeadsCount', v_updated_enriched_leads,
    'updatedEnrichedOpportunitiesCount', v_updated_enriched_opportunities,
    'updatedPeopleSearchLeadsCount', v_updated_people_search_leads,
    'cancelledApolloCallbacksCount', v_cancelled_callbacks,
    'campaignSafetyStop', v_safety_stop
  );
end;
$$;

create or replace function public.delete_native_research_messaging_subject_v1(
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_email_hash text;
  v_suppression jsonb;
  v_deleted jsonb;
  v_deleted_callbacks integer := 0;
  v_deleted_enriched_leads integer := 0;
  v_deleted_enriched_opportunities integer := 0;
  v_deleted_people_search_leads integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform set_config('app.retention_delete', 'off', true);
  v_suppression := public.apply_privacy_suppression_v2(
    v_email,
    'privacy_request_delete_preserve_block'
  );
  if exists (
    select 1
    from public.outbound_dispatches od
    left join public.messaging_draft_versions mdv on mdv.id = od.version_id
    where od.status = 'sending'
      and lower(trim(coalesce(
        nullif(od.metadata #>> '{recipient,email}', ''),
        nullif(mdv.recipient ->> 'email', ''),
        ''
      ))) = v_email
  ) then
    return jsonb_build_object(
      'outcome', 'pending',
      'blocked', true,
      'reason', 'outbound_dispatch_sending',
      'campaignSafetyStop', v_suppression -> 'campaignSafetyStop'
    );
  end if;

  v_deleted := public.delete_native_research_messaging_subject_core_v1(v_email);
  if coalesce(v_deleted ->> 'outcome', '') <> 'deleted' then
    return v_deleted || jsonb_build_object('campaignSafetyStop', v_suppression -> 'campaignSafetyStop');
  end if;

  v_email_hash := encode(
    extensions.digest(convert_to(v_email, 'UTF8'), 'sha256'),
    'hex'
  );

  with deleted as (
    delete from public.apollo_enrichment_callbacks callback
    where callback.privacy_subject_hash = v_email_hash
      or exists (
        select 1
        from public.apollo_contact_subject_refs ref
        where ref.target_table = callback.target_table
          and ref.target_lead_id = callback.target_lead_id
          and ref.email_hash = v_email_hash
      )
    returning callback.id
  ) select count(*) into v_deleted_callbacks from deleted;

  with deleted as (
    delete from public.enriched_leads target
    where exists (
      select 1
      from public.apollo_contact_subject_refs ref
      where ref.target_table = 'enriched_leads'
        and ref.target_lead_id = target.id
        and ref.email_hash = v_email_hash
    )
    returning target.id
  ) select count(*) into v_deleted_enriched_leads from deleted;

  with deleted as (
    delete from public.enriched_opportunities target
    where lower(trim(coalesce(target.email, ''))) = v_email
      or exists (
        select 1
        from public.apollo_contact_subject_refs ref
        where ref.target_table = 'enriched_opportunities'
          and ref.target_lead_id = target.id::text
          and ref.email_hash = v_email_hash
      )
    returning target.id
  ) select count(*) into v_deleted_enriched_opportunities from deleted;

  with deleted as (
    delete from public.people_search_leads target
    where lower(trim(coalesce(target.email, ''))) = v_email
      or exists (
        select 1
        from public.apollo_contact_subject_refs ref
        where ref.target_table = 'people_search_leads'
          and ref.target_lead_id = target.id
          and ref.email_hash = v_email_hash
      )
    returning target.id
  ) select count(*) into v_deleted_people_search_leads from deleted;

  delete from public.apollo_contact_subject_refs ref
  where (ref.target_table = 'enriched_leads' and not exists (
      select 1 from public.enriched_leads target where target.id = ref.target_lead_id
    ))
    or (ref.target_table = 'enriched_opportunities' and not exists (
      select 1 from public.enriched_opportunities target where target.id::text = ref.target_lead_id
    ))
    or (ref.target_table = 'people_search_leads' and not exists (
      select 1 from public.people_search_leads target where target.id = ref.target_lead_id
    ));

  delete from public.apollo_contact_subject_refs ref
  where ref.email_hash = v_email_hash;

  return v_deleted || jsonb_build_object(
    'enrichedLeads', coalesce((v_deleted ->> 'enrichedLeads')::integer, 0) + v_deleted_enriched_leads,
    'enrichedOpportunities', v_deleted_enriched_opportunities,
    'peopleSearchLeads', v_deleted_people_search_leads,
    'apolloEnrichmentCallbacks', v_deleted_callbacks,
    'campaignSafetyStop', v_suppression -> 'campaignSafetyStop'
  );
end;
$$;

revoke all on function public.lookup_research_messaging_subject_v1(text)
  from public, anon, authenticated;
revoke all on function public.apply_privacy_suppression_v2(text, text)
  from public, anon, authenticated;
revoke all on function public.delete_native_research_messaging_subject_v1(text)
  from public, anon, authenticated;
grant execute on function public.lookup_research_messaging_subject_v1(text) to service_role;
grant execute on function public.apply_privacy_suppression_v2(text, text) to service_role;
grant execute on function public.delete_native_research_messaging_subject_v1(text) to service_role;

notify pgrst, 'reload schema';

commit;
