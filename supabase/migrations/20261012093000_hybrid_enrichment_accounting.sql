-- Freeze cache fulfillment under the existing quota claim. A contact is charged
-- once whether fulfilled locally, externally, or partly by both. Browser roles
-- cannot inspect plans/provenance or forge a local fulfillment.
create table public.hybrid_enrichment_items (
  organization_id uuid not null,
  user_id uuid not null,
  resource text not null check (resource in ('enrich','investigate')),
  operation_id text not null,
  target_id text not null references public.enriched_leads(id) on delete cascade,
  client_ref text,
  apollo_person_id text not null,
  requested_email boolean not null,
  requested_phone boolean not null,
  plan_encrypted text not null check (plan_encrypted like 'enc:v1.%' and length(plan_encrypted)<=16000),
  state text not null default 'planned' check (state in ('planned','done','cancelled')),
  cache_processed boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 days',
  primary key (organization_id,user_id,resource,operation_id,target_id),
  foreign key (organization_id,user_id,resource,operation_id)
    references public.antonia_quota_operations(organization_id,user_id,resource,operation_id) on delete cascade
);
alter table public.hybrid_enrichment_items enable row level security;
revoke all on public.hybrid_enrichment_items from public,anon,authenticated;
grant all on public.hybrid_enrichment_items to service_role;

create function public.register_hybrid_enrichment_item_v1(p_org uuid,p_user uuid,p_resource text,p_operation text,p_claim uuid,
  p_target text,p_client_ref text,p_person text,p_email boolean,p_phone boolean,p_plan text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  perform 1 from public.antonia_quota_operations where organization_id=p_org and user_id=p_user and resource=p_resource
    and operation_id=p_operation and claim_token=p_claim and status='claimed' for update;
  if not found then return false; end if;
  perform 1 from public.enriched_leads where id=p_target and organization_id=p_org and user_id=p_user
    and source_provider='apollo' and source_provider_id=p_person and enrichment_status<>'suppressed';
  if not found then return false; end if;
  insert into public.hybrid_enrichment_items(organization_id,user_id,resource,operation_id,target_id,client_ref,apollo_person_id,
    requested_email,requested_phone,plan_encrypted) values(p_org,p_user,p_resource,p_operation,p_target,p_client_ref,p_person,p_email,p_phone,p_plan)
    on conflict do nothing;
  return exists (select 1 from public.hybrid_enrichment_items where organization_id=p_org and user_id=p_user and resource=p_resource
    and operation_id=p_operation and target_id=p_target and apollo_person_id=p_person and requested_email=p_email and requested_phone=p_phone);
end; $$;

create function public.apply_hybrid_cached_fields_v1(p_org uuid,p_user uuid,p_resource text,p_operation text,p_claim uuid,p_target text,p_candidate jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_item public.hybrid_enrichment_items%rowtype; v_row public.enriched_leads%rowtype;
  v_email text; v_phone text; v_changed boolean;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if jsonb_typeof(p_candidate) is distinct from 'object' then raise exception 'invalid candidate'; end if;
  perform 1 from public.antonia_quota_operations where organization_id=p_org and user_id=p_user and resource=p_resource
    and operation_id=p_operation and claim_token=p_claim and status in ('claimed','submitted') for update;
  if not found then return jsonb_build_object('outcome','claim_lost'); end if;
  select * into v_item from public.hybrid_enrichment_items where organization_id=p_org and user_id=p_user and resource=p_resource
    and operation_id=p_operation and target_id=p_target for update;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user) then
    update public.hybrid_enrichment_items set state='cancelled' where organization_id=p_org and user_id=p_user and resource=p_resource
      and operation_id=p_operation and target_id=p_target;
    return jsonb_build_object('outcome','suppressed');
  end if;
  if v_item.expires_at<=now() then return jsonb_build_object('outcome','expired'); end if;
  select * into v_row from public.enriched_leads where id=p_target and organization_id=p_org and user_id=p_user for update;
  if not found or v_row.source_provider is distinct from 'apollo' or v_row.source_provider_id is distinct from v_item.apollo_person_id
    or v_row.enrichment_status='suppressed' then
    update public.hybrid_enrichment_items set state='cancelled' where organization_id=p_org and user_id=p_user and resource=p_resource
      and operation_id=p_operation and target_id=p_target;
    return jsonb_build_object('outcome','suppressed');
  end if;
  if v_item.state='done' then return jsonb_build_object('outcome','replay'); end if;
  v_email:=case when v_item.requested_email and nullif(trim(v_row.email),'') is null then nullif(lower(trim(p_candidate->>'email')),'') end;
  v_phone:=case when v_item.requested_phone and nullif(trim(v_row.primary_phone),'') is null
    and coalesce(jsonb_array_length(v_row.phone_numbers),'0')=0 then nullif(trim(p_candidate->>'mobile'),'') end;
  if v_email is not null and (length(v_email)>320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'invalid cache email'; end if;
  if v_phone is not null and v_phone !~ '^\+[0-9]{8,15}$' then raise exception 'invalid cache phone'; end if;
  v_changed:=v_email is not null or v_phone is not null;
  update public.enriched_leads set email=coalesce(v_email,email),
    full_name=case when nullif(trim(full_name),'') is null or full_name like '%*%' then coalesce(nullif(p_candidate->>'fullName',''),full_name) else full_name end,
    linkedin_url=coalesce(nullif(linkedin_url,''),nullif(p_candidate->>'linkedinUrl','')),
    email_status=case when v_email is not null then case when p_candidate->>'emailStatus' in ('verified','unverified') then p_candidate->>'emailStatus' else 'unknown' end else email_status end,
    primary_phone=coalesce(v_phone,primary_phone),
    phone_numbers=case when v_phone is not null then jsonb_build_array(jsonb_build_object('raw_number',v_phone,'sanitized_number',v_phone,'type','mobile')) else phone_numbers end,
    enrichment_status=case when v_changed or nullif(trim(email),'') is not null or nullif(trim(primary_phone),'') is not null then 'completed' else enrichment_status end,
    data=coalesce(data,'{}'::jsonb)||jsonb_build_object('contactProvenance',coalesce(data->'contactProvenance','{}'::jsonb)||
      case when v_email is not null then jsonb_build_object('email',jsonb_build_object('provider','microworlds','observedAt',p_candidate->>'observedAt')) else '{}'::jsonb end||
      case when v_phone is not null then jsonb_build_object('phone',jsonb_build_object('provider','microworlds','observedAt',p_candidate->>'observedAt')) else '{}'::jsonb end),
    updated_at=now() where id=p_target and organization_id=p_org and user_id=p_user returning * into v_row;
  update public.hybrid_enrichment_items set state='done',cache_processed=v_changed and v_row.enrichment_status<>'suppressed'
    where organization_id=p_org and user_id=p_user and resource=p_resource and operation_id=p_operation and target_id=p_target;
  return jsonb_build_object('outcome',case when v_row.enrichment_status='suppressed' then 'suppressed' else 'processed' end,
    'cacheProcessed',v_changed and v_row.enrichment_status<>'suppressed');
end; $$;

create function public.apply_hybrid_apollo_fields_v1(p_org uuid,p_user uuid,p_resource text,p_operation text,p_target text,p_candidate jsonb,p_pending_phone boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_item public.hybrid_enrichment_items%rowtype; v_row public.enriched_leads%rowtype; v_email text; v_phone text; v_numbers jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  perform 1 from public.antonia_quota_operations where organization_id=p_org and user_id=p_user and resource=p_resource
    and operation_id=p_operation and status='submitted' for update;
  if not found then raise exception 'hybrid claim unavailable'; end if;
  select * into v_item from public.hybrid_enrichment_items where organization_id=p_org and user_id=p_user and resource=p_resource
    and operation_id=p_operation and target_id=p_target;
  if not found or coalesce(p_candidate->>'source_provider_id',p_candidate->>'apollo_id') is distinct from v_item.apollo_person_id
    then raise exception 'hybrid identity mismatch'; end if;
  select * into v_row from public.enriched_leads where id=p_target and organization_id=p_org and user_id=p_user for update;
  if not found or v_row.enrichment_status='suppressed' then return to_jsonb(v_row); end if;
  v_email:=case when v_item.requested_email then nullif(lower(trim(p_candidate->>'email')),'') end;
  v_phone:=case when v_item.requested_phone and nullif(trim(v_row.primary_phone),'') is null
    and coalesce(jsonb_array_length(v_row.phone_numbers),0)=0 then nullif(trim(p_candidate->>'primary_phone'),'') end;
  v_numbers:=case when v_phone is not null then p_candidate->'phone_numbers' end;
  update public.enriched_leads set
    email=case when nullif(trim(email),'') is null then coalesce(v_email,email) else email end,
    email_status=case when v_email is not null and (nullif(trim(email),'') is null or lower(trim(email))=v_email)
      then coalesce(nullif(p_candidate->>'email_status',''),email_status) else email_status end,
    primary_phone=coalesce(v_phone,primary_phone),
    phone_numbers=case when v_phone is not null and jsonb_typeof(v_numbers)='array' and jsonb_array_length(v_numbers)>0 then v_numbers else phone_numbers end,
    full_name=case when nullif(trim(full_name),'') is null or full_name like '%*%' then coalesce(nullif(p_candidate->>'full_name',''),full_name) else full_name end,
    linkedin_url=coalesce(nullif(linkedin_url,''),nullif(p_candidate->>'linkedin_url','')),
    enrichment_status=case when p_pending_phone and v_phone is null and nullif(trim(primary_phone),'') is null then 'pending_phone'
      when v_email is not null or v_phone is not null or nullif(trim(email),'') is not null or nullif(trim(primary_phone),'') is not null then 'completed' else 'failed' end,
    updated_at=now() where id=p_target and organization_id=p_org and user_id=p_user returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create function public.settle_hybrid_enrichment_operation_v1(p_org uuid,p_user uuid,p_resource text,p_operation text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_op public.antonia_quota_operations%rowtype; v_count integer; v_refund integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  select * into v_op from public.antonia_quota_operations where organization_id=p_org and user_id=p_user and resource=p_resource
    and operation_id=p_operation and status='submitted' for update;
  if not found or v_op.claim_token is null then return false; end if;
  if exists(select 1 from public.hybrid_enrichment_items where organization_id=p_org and user_id=p_user and resource=p_resource
      and operation_id=p_operation and state='planned') or exists(select 1 from public.apollo_enrichment_callbacks where organization_id=p_org
      and user_id=p_user and quota_resource=p_resource and operation_id=p_operation and status<>'terminal') then return false; end if;
  select count(*) into v_count from (
    select target_lead_id from public.apollo_enrichment_callbacks where organization_id=p_org and user_id=p_user
      and quota_resource=p_resource and operation_id=p_operation and provider_queued_at is not null
    union
    select target_id::text from public.hybrid_enrichment_items where organization_id=p_org and user_id=p_user and resource=p_resource
      and operation_id=p_operation and cache_processed
  ) billable;
  v_refund:=v_op.consumed_count-v_count;
  if v_refund<0 then raise exception 'hybrid quota exceeds reservation'; end if;
  if v_refund>0 then
    if v_op.credit_mode is not null then
      if not public.release_antonia_organization_credits_v2(p_org,p_user,v_op.quota_day,p_resource,v_refund,v_op.credit_mode,v_op.credit_group_id)
        then raise exception 'credit bucket unavailable'; end if;
    elsif v_op.quota_scope='user' then
      if not public.release_antonia_user_daily_credits_v1(p_user,v_op.quota_day,p_resource,v_refund) then raise exception 'credit bucket unavailable'; end if;
    else
      update public.antonia_daily_usage set leads_enriched=leads_enriched-case when p_resource='enrich' then v_refund else 0 end,
        leads_investigated=leads_investigated-case when p_resource='investigate' then v_refund else 0 end,updated_at=now()
        where organization_id=p_org and date=v_op.quota_day;
      if not found then raise exception 'credit bucket unavailable'; end if;
    end if;
    update public.antonia_quota_operations set consumed_count=v_count,quota_count_after=greatest(0,quota_count_after-v_refund),updated_at=now()
      where organization_id=p_org and user_id=p_user and resource=p_resource and operation_id=p_operation;
  end if;
  return public.complete_antonia_quota_operation_v1(p_org,p_user,p_resource,p_operation,v_op.claim_token,'completed',200,
    jsonb_build_object('operationId',p_operation,'operationStatus','completed','queued',false));
end; $$;

-- Wrap the deployed settlement boundary, preserving its original implementation
-- for operations without hybrid items. This is forward-only; no history is rewritten.
alter function public.settle_apollo_enrichment_quota_if_ready_v1(uuid) rename to settle_apollo_enrichment_quota_pre_hybrid_v1;
create function public.settle_apollo_enrichment_quota_if_ready_v1(p_callback_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_callback public.apollo_enrichment_callbacks%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  select * into v_callback from public.apollo_enrichment_callbacks where id=p_callback_id;
  if not found then return false; end if;
  if exists(select 1 from public.hybrid_enrichment_items where organization_id=v_callback.organization_id and user_id=v_callback.user_id
    and resource=v_callback.quota_resource and operation_id=v_callback.operation_id) then
    return public.settle_hybrid_enrichment_operation_v1(v_callback.organization_id,v_callback.user_id,v_callback.quota_resource,v_callback.operation_id);
  end if;
  return public.settle_apollo_enrichment_quota_pre_hybrid_v1(p_callback_id);
end; $$;

-- Late callback writes for hybrid targets only fill gaps. Lock order matches the
-- existing RPC (quota -> callback -> target), so a concurrent user edit wins.
alter function public.apply_apollo_enrichment_callback_v1(text,text,text,text,jsonb) rename to apply_apollo_enrichment_callback_pre_hybrid_v1;
create function public.apply_apollo_enrichment_callback_v1(p_token_hash text,p_provider_request_id text,p_provider_status text,p_payload_hash text,p_candidate jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_callback public.apollo_enrichment_callbacks%rowtype; v_target public.enriched_leads%rowtype; v_result jsonb; v_hybrid boolean:=false;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  select * into v_callback from public.apollo_enrichment_callbacks where token_hash=lower(trim(p_token_hash));
  if found and v_callback.target_table='enriched_leads' and exists(select 1 from public.hybrid_enrichment_items
    where organization_id=v_callback.organization_id and user_id=v_callback.user_id and resource=v_callback.quota_resource
    and operation_id=v_callback.operation_id and target_id::text=v_callback.target_lead_id) then
    v_hybrid:=true;
    perform 1 from public.antonia_quota_operations where organization_id=v_callback.organization_id and user_id=v_callback.user_id
      and resource=v_callback.quota_resource and operation_id=v_callback.operation_id for update;
    perform 1 from public.apollo_enrichment_callbacks where id=v_callback.id for update;
    select * into v_target from public.enriched_leads where id::text=v_callback.target_lead_id
      and organization_id=v_callback.organization_id and user_id=v_callback.user_id for update;
    if found then
      if nullif(trim(v_target.email),'') is not null then
        if lower(trim(v_target.email))=lower(trim(p_candidate->>'email')) then p_candidate:=p_candidate-'email';
        else p_candidate:=p_candidate-'email'-'email_status'; end if;
      end if;
      if nullif(trim(v_target.primary_phone),'') is not null or coalesce(jsonb_array_length(v_target.phone_numbers),0)>0
        then p_candidate:=p_candidate-'phone_numbers'-'primary_phone'; end if;
    end if;
  end if;
  v_result:=public.apply_apollo_enrichment_callback_pre_hybrid_v1(p_token_hash,p_provider_request_id,p_provider_status,p_payload_hash,p_candidate);
  if v_hybrid and v_result->>'outcome'='processed' then
    update public.enriched_leads set enrichment_status='completed' where id::text=v_callback.target_lead_id
      and organization_id=v_callback.organization_id and user_id=v_callback.user_id and enrichment_status<>'suppressed'
      and (nullif(trim(email),'') is not null or nullif(trim(primary_phone),'') is not null);
  end if;
  return v_result;
end; $$;

revoke all on function public.register_hybrid_enrichment_item_v1(uuid,uuid,text,text,uuid,text,text,text,boolean,boolean,text),
  public.apply_hybrid_cached_fields_v1(uuid,uuid,text,text,uuid,text,jsonb),public.apply_hybrid_apollo_fields_v1(uuid,uuid,text,text,text,jsonb,boolean),public.settle_hybrid_enrichment_operation_v1(uuid,uuid,text,text),
  public.settle_apollo_enrichment_quota_if_ready_v1(uuid),public.apply_apollo_enrichment_callback_v1(text,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.register_hybrid_enrichment_item_v1(uuid,uuid,text,text,uuid,text,text,text,boolean,boolean,text),
  public.apply_hybrid_cached_fields_v1(uuid,uuid,text,text,uuid,text,jsonb),public.apply_hybrid_apollo_fields_v1(uuid,uuid,text,text,text,jsonb,boolean),public.settle_hybrid_enrichment_operation_v1(uuid,uuid,text,text),
  public.settle_apollo_enrichment_quota_if_ready_v1(uuid),public.apply_apollo_enrichment_callback_v1(text,text,text,text,jsonb) to service_role;
