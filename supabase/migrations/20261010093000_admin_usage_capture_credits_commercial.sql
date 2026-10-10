-- Add one movement per actual debit/refund, not per enforcement bucket. Keep
-- the installed quota body/permissions intact, including legacy and hybrid rules.
do $migration$
declare body text; marker text;
begin
  body:=pg_get_functiondef('public.consume_antonia_organization_credits_v2(uuid,uuid,text,integer)'::regprocedure);
  marker:='return v_result || v_context;';
  if (length(body)-length(replace(body,marker,'')))/length(marker)<>1 then raise exception 'Unsupported organization consume definition'; end if;
  body:=replace(body,marker,'if v_allowed then
    perform public.admin_record_credit_movement(p_organization_id,p_user_id,v_day,v_resource,p_requested_count,v_mode,v_group_id);
  end if;
  return v_result || v_context;');
  execute body;
  body:=pg_get_functiondef('public.release_antonia_organization_credits_v2(uuid,uuid,date,text,integer,text,uuid)'::regprocedure);
  marker:='return true;';
  if (length(body)-length(replace(body,marker,'')))/length(marker)<>1 then raise exception 'Unsupported organization release definition'; end if;
  body:=replace(body,marker,'perform public.admin_record_credit_movement(p_organization_id,p_user_id,p_day,v_resource,-p_released_count,p_mode,p_group_id);
  return true;');
  execute body;
end; $migration$;

create function public.admin_capture_legacy_credit() returns trigger language plpgsql security definer set search_path='' as $$
declare resource text; before_count integer; after_count integer; current_data jsonb:=to_jsonb(new); previous_data jsonb;
begin
  if tg_op='UPDATE' then previous_data:=to_jsonb(old); else previous_data:='{}'::jsonb; end if;
  foreach resource in array array['search','enrich','investigate'] loop
    before_count:=coalesce((previous_data->>(resource||'_count'))::integer,0);
    after_count:=(current_data->>(resource||'_count'))::integer;
    if before_count<>after_count then
      -- This account-wide bucket has no organization. Never assign it to every
      -- company the person belongs to; only platform analytics can see it.
      perform public.admin_record_credit_movement(null,new.user_id,new.date,resource,after_count-before_count,'legacy',null);
    end if;
  end loop;
  return null;
end; $$;
create trigger admin_capture_legacy_credit after insert or update on public.antonia_user_daily_credits for each row execute function public.admin_capture_legacy_credit();

create function public.admin_capture_commercial() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb:=to_jsonb(new); org uuid; usr uuid; source_ref text; entity text; group_ref uuid; event_module text;
  at_time timestamptz; state text; commitment jsonb; thread_ref text;
begin
  org:=nullif(item->>'organization_id','')::uuid; if org is null then return null; end if;
  usr:=nullif(item->>'user_id','')::uuid; source_ref:=item->>'id';
  group_ref:=public.admin_usage_group(org,usr);
  entity:=case when nullif(trim(item->>'email'),'') is not null then md5(org::text||':'||lower(trim(item->>'email'))) else md5(org::text||':'||tg_table_name||':'||source_ref) end;
  if tg_table_name='contacted_leads' then
    event_module:=case when coalesce(item->>'channel',item->'data'->>'channel')='linkedin' then 'linkedin' else 'email' end;
    thread_ref:=case when nullif(item->>'thread_key','') is not null then md5(org::text||':'||(item->>'thread_key')) end;
    at_time:=nullif(item->>'sent_at','')::timestamptz;
    if at_time is not null then
      insert into public.admin_commercial_facts(organization_id,user_id,group_id,source,source_id,entity_key,thread_key,kind,module,status,occurred_at)
      values(org,usr,group_ref,tg_table_name,source_ref,entity,thread_ref,'contact_sent',event_module,'recorded',at_time)
      on conflict(organization_id,source,source_id,kind,occurred_at) do update set thread_key=coalesce(excluded.thread_key,public.admin_commercial_facts.thread_key);
    end if;
    at_time:=nullif(item->>'replied_at','')::timestamptz;
    if at_time is not null then
      state:=case when item->>'reply_intent' in ('positive','meeting_request','neutral','negative','unsubscribe','auto_reply','bounce','delivery_failure') then item->>'reply_intent' else 'unclassified' end;
      insert into public.admin_commercial_facts(organization_id,user_id,group_id,source,source_id,entity_key,thread_key,kind,module,intent,status,occurred_at)
      values(org,usr,group_ref,tg_table_name,source_ref,entity,thread_ref,'reply_observed',event_module,state,'recorded',at_time)
      on conflict(organization_id,source,source_id,kind,occurred_at) do update set intent=excluded.intent,thread_key=coalesce(excluded.thread_key,public.admin_commercial_facts.thread_key);
    end if;
    commitment:=item->'data'->'commitment';
    if commitment->>'kind'='meeting' and public.admin_usage_time(commitment->>'dueAt') is not null then
      at_time:=coalesce(public.admin_usage_time(commitment->>'updatedAt'),clock_timestamp());
      source_ref:=(item->>'id')||':'||coalesce(commitment->>'id',commitment->>'dueAt');
      if tg_op='INSERT' or old.data->'commitment'->>'id' is distinct from commitment->>'id' then
        insert into public.admin_commercial_facts(organization_id,user_id,group_id,source,source_id,entity_key,kind,status,occurred_at)
        values(org,usr,group_ref,tg_table_name,source_ref,md5(org::text||':'||source_ref),'meeting_registered','recorded',at_time)
        on conflict(organization_id,source,source_id,kind,occurred_at) do nothing;
      end if;
      at_time:=public.admin_usage_time(commitment->>'completedAt');
      if at_time is not null then
        insert into public.admin_commercial_facts(organization_id,user_id,group_id,source,source_id,entity_key,kind,status,occurred_at)
        values(org,usr,group_ref,tg_table_name,source_ref,md5(org::text||':'||source_ref),'meeting_completed','marked_completed',at_time)
        on conflict(organization_id,source,source_id,kind,occurred_at) do nothing;
      end if;
    end if;
  elsif tg_table_name='leads' then
    if tg_op='INSERT' then
      insert into public.admin_commercial_facts(organization_id,user_id,group_id,source,source_id,entity_key,kind,status,occurred_at)
      values(org,usr,group_ref,tg_table_name,source_ref,entity,'contact_saved','recorded',new.created_at) on conflict do nothing;
    end if;
  end if;
  return null;
end; $$;
create trigger admin_capture_contacted after insert or update on public.contacted_leads for each row execute function public.admin_capture_commercial();
create trigger admin_capture_saved after insert on public.leads for each row execute function public.admin_capture_commercial();
revoke all on function public.admin_capture_legacy_credit(),public.admin_capture_commercial() from public,anon,authenticated;

-- Freeze the reporting team when work happens. A later team reassignment must
-- not move completed work to the new team. Only metadata enters this table.
create function public.admin_capture_operation() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb:=to_jsonb(new); org uuid; usr uuid; event_kind text; event_status text; at_time timestamptz; source_ref text; entity text; event_module text;
begin
  org:=nullif(item->>'organization_id','')::uuid;if org is null then return null;end if;
  usr:=nullif(coalesce(item->>'user_id',item->>'changed_by'),'')::uuid;
  source_ref:=item->>'id';event_status:=left(coalesce(item->>'status',item->>'lifecycle',item->>'to_stage','unknown'),80);
  at_time:=public.admin_usage_time(item->>'created_at');
  if tg_table_name='messaging_drafts' then event_kind:='draft_prepared';event_module:=case when item->>'channel'='linkedin' then 'linkedin' else 'email' end;
  elsif tg_table_name='lead_research_jobs' then
    event_module:='research';
    event_kind:=case when event_status='completed' then 'research_completed' when event_status in ('failed','timeout') then 'research_failed' else 'research_requested' end;
    if event_kind<>'research_requested' then at_time:=coalesce(public.admin_usage_time(item->>'updated_at'),at_time);end if;
  elsif tg_table_name='cowork_runs' then event_kind:='cowork_turn';event_module:='cowork';
  elsif tg_table_name='extension_linkedin_sends' then
    event_module:='linkedin';
    event_kind:=case when event_status='confirmed' then 'linkedin_sent' when event_status='uncertain' then 'linkedin_uncertain' else 'linkedin_prepared' end;
    if event_kind<>'linkedin_prepared' then at_time:=coalesce(public.admin_usage_time(item->>'updated_at'),at_time);end if;
  elsif tg_table_name='crm_stage_events' then
    event_module:='crm';event_kind:=event_status;at_time:=public.admin_usage_time(item->>'changed_at');
  else return null;end if;
  if at_time is null then return null;end if;
  entity:=case when tg_table_name='crm_stage_events' then md5(org::text||':'||(item->>'crm_id'))
    else md5(org::text||':'||tg_table_name||':'||coalesce(item->>'profile_url',source_ref)) end;
  insert into public.admin_commercial_facts(organization_id,user_id,group_id,source,source_id,entity_key,kind,module,status,occurred_at)
  values(org,usr,public.admin_usage_group(org,usr),tg_table_name,source_ref,entity,event_kind,event_module,event_status,at_time)
  on conflict(organization_id,source,source_id,kind,occurred_at) do update set status=excluded.status;
  return null;
end; $$;
create trigger admin_capture_research after insert or update on public.lead_research_jobs for each row execute function public.admin_capture_operation();
create trigger admin_capture_drafts after insert or update on public.messaging_drafts for each row execute function public.admin_capture_operation();
create trigger admin_capture_cowork after insert or update on public.cowork_runs for each row execute function public.admin_capture_operation();
create trigger admin_capture_linkedin after insert or update on public.extension_linkedin_sends for each row execute function public.admin_capture_operation();
create trigger admin_capture_crm after insert on public.crm_stage_events for each row execute function public.admin_capture_operation();
revoke all on function public.admin_capture_operation() from public,anon,authenticated;
