-- Set-based, metadata-only aggregates. Only the authorized BFF can execute.
create function public.admin_usage_report_v1(p_orgs uuid[],p_from date,p_to date,p_user uuid default null,p_group uuid default null,p_horizon integer default 14,p_legacy boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; since_at timestamptz; until_at timestamptz;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>731 or p_horizon not in (7,14,30,60) or coalesce(cardinality(p_orgs),0)>1000 then
    raise exception 'invalid report range' using errcode='22023'; end if;
  since_at:=p_from::timestamp at time zone 'America/Santiago';
  until_at:=(p_to+1)::timestamp at time zone 'America/Santiago';
  with
  scope_users as (select organization_id,user_id from public.organization_reporting_group_members
    where organization_id=any(p_orgs) and group_id=p_group and unassigned_at is null),
  views as (select v.organization_id,v.user_id,v.group_id,v.module,'module_opened'::text kind,'observed'::text status,'user'::text actor,
    v.occurred_at at_time,v.event_id::text entity from public.app_usage_views v
    where v.organization_id=any(p_orgs) and v.occurred_at>=since_at and v.occurred_at<until_at
      and (p_user is null or v.user_id=p_user) and (p_group is null or v.group_id=p_group)),
  captured as (select f.* from public.admin_commercial_facts f
    where f.organization_id=any(p_orgs) and f.occurred_at>=since_at and f.occurred_at<until_at
      and (p_user is null or f.user_id=p_user) and (p_group is null or f.group_id=p_group)),
  commercial as (
    select organization_id,user_id,group_id,case when source='lead_research_jobs' then 'research' when source='cowork_runs' then 'cowork'
      when source='extension_linkedin_sends' then 'linkedin' when source='crm_stage_events' then 'crm'
      when kind='contact_saved' then 'contacts' when kind like 'meeting_%' then 'crm' else module end module,
      kind,status,'system'::text actor,occurred_at at_time,entity_key entity from captured where kind<>'reply_observed'
    union all
    select organization_id,user_id,group_id,module,categories.kind,'recorded','system',occurred_at,entity_key
    from captured cross join lateral (select 'human_reply'::text kind where intent in ('positive','meeting_request','neutral','negative','unsubscribe')
      union all select 'interest' where intent in ('positive','meeting_request')
      union all select 'meeting_requested' where intent='meeting_request') categories where captured.kind='reply_observed'
  ),
  old_contacts as (select c.id,c.organization_id,c.user_id,c.email,c.sent_at,c.replied_at,c.reply_intent,c.data,
      c.reply_sync_succeeded_at,c.conversation_resolved_at,c.conversation_outbound_at,
      public.admin_usage_group(c.organization_id,c.user_id) group_id from public.contacted_leads c
    where c.organization_id=any(p_orgs) and (p_user is null or c.user_id=p_user)
      and (p_group is null or exists(select 1 from scope_users s where s.organization_id=c.organization_id and s.user_id=c.user_id))),
  legacy as (
    select c.organization_id,c.user_id,c.group_id,'email'::text module,'contact_sent'::text kind,'recorded'::text status,'unknown'::text actor,c.sent_at at_time,
      md5(c.organization_id::text||':'||lower(trim(c.email))) entity from old_contacts c where c.sent_at>=since_at and c.sent_at<until_at
      and not exists(select 1 from public.admin_commercial_facts f where f.organization_id=c.organization_id and f.source='contacted_leads' and f.source_id=c.id::text and f.kind='contact_sent' and f.occurred_at=c.sent_at)
    union all
    select l.organization_id,l.user_id,public.admin_usage_group(l.organization_id,l.user_id),'contacts','contact_saved','recorded','unknown',l.created_at,
      md5(l.organization_id::text||':leads:'||l.id::text) from public.leads l where l.organization_id=any(p_orgs) and l.created_at>=since_at and l.created_at<until_at
      and (p_user is null or l.user_id=p_user) and (p_group is null or exists(select 1 from scope_users s where s.organization_id=l.organization_id and s.user_id=l.user_id))
      and not exists(select 1 from public.admin_commercial_facts f where f.organization_id=l.organization_id and f.source='leads' and f.source_id=l.id::text and f.kind='contact_saved')
    union all
    select c.organization_id,c.user_id,c.group_id,'email',k.kind,'latest_classification','unknown',c.replied_at,
      md5(c.organization_id::text||':'||lower(trim(c.email))) from old_contacts c
      cross join lateral (select 'human_reply'::text kind where c.reply_intent in ('positive','meeting_request','neutral','negative','unsubscribe')
        union all select 'interest' where c.reply_intent in ('positive','meeting_request')
        union all select 'meeting_requested' where c.reply_intent='meeting_request') k
      where c.replied_at>=since_at and c.replied_at<until_at and not exists(select 1 from public.admin_commercial_facts f
        where f.organization_id=c.organization_id and f.source='contacted_leads' and f.source_id=c.id::text and f.kind='reply_observed' and f.occurred_at=c.replied_at)
  ),
  operations as (
    select r.organization_id,r.user_id,public.admin_usage_group(r.organization_id,r.user_id) group_id,'research'::text module,
      case when r.status='completed' then 'research_completed' else 'research_requested' end kind,r.status::text status,'system'::text actor,
      coalesce(r.updated_at,r.created_at) at_time,r.id::text entity from public.lead_research_jobs r
      where r.organization_id=any(p_orgs) and coalesce(r.updated_at,r.created_at)>=since_at and coalesce(r.updated_at,r.created_at)<until_at
        and not exists(select 1 from public.admin_commercial_facts f where f.organization_id=r.organization_id and f.source='lead_research_jobs' and f.source_id=r.id::text)
    union all
    select d.organization_id,d.user_id,public.admin_usage_group(d.organization_id,d.user_id),case when d.channel='linkedin' then 'linkedin' else 'email' end,'draft_prepared',d.lifecycle::text,'system',d.created_at,d.id::text
      from public.messaging_drafts d where d.organization_id=any(p_orgs) and d.created_at>=since_at and d.created_at<until_at
        and not exists(select 1 from public.admin_commercial_facts f where f.organization_id=d.organization_id and f.source='messaging_drafts' and f.source_id=d.id::text)
    union all
    select c.organization_id,c.user_id,public.admin_usage_group(c.organization_id,c.user_id),'cowork','cowork_turn',c.status::text,'unknown',c.created_at,c.id::text
      from public.cowork_runs c where c.organization_id=any(p_orgs) and c.created_at>=since_at and c.created_at<until_at
        and not exists(select 1 from public.admin_commercial_facts f where f.organization_id=c.organization_id and f.source='cowork_runs' and f.source_id=c.id::text)
    union all
    select l.organization_id,l.user_id,public.admin_usage_group(l.organization_id,l.user_id),'linkedin',case when l.status='confirmed' then 'linkedin_sent' else 'linkedin_prepared' end,l.status::text,'system',l.created_at,l.id::text
      from public.extension_linkedin_sends l where l.organization_id=any(p_orgs) and l.created_at>=since_at and l.created_at<until_at
        and not exists(select 1 from public.admin_commercial_facts f where f.organization_id=l.organization_id and f.source='extension_linkedin_sends' and f.source_id=l.id::text)
    union all
    select e.organization_id,e.changed_by,public.admin_usage_group(e.organization_id,e.changed_by),'crm',e.to_stage,'recorded','unknown',e.changed_at,
      md5(e.organization_id::text||':'||e.crm_id) from public.crm_stage_events e where e.organization_id=any(p_orgs) and e.changed_at>=since_at and e.changed_at<until_at
      and e.to_stage in ('closed_won','closed_lost','negotiation','qualified','meeting')
      and not exists(select 1 from public.admin_commercial_facts f where f.organization_id=e.organization_id and f.source='crm_stage_events' and f.source_id=e.id::text)
    union all
    select e.organization_id,e.actor_user_id,public.admin_usage_group(e.organization_id,e.actor_user_id),'search','search_requested',e.status,
      case when e.actor_type='user' then 'user' else 'system' end,e.occurred_at,coalesce(e.operation_id,e.id::text)
      from public.antonia_event_ledger e where e.organization_id=any(p_orgs) and e.occurred_at>=since_at and e.occurred_at<until_at
      and e.event_type='search.requested' and e.source_confidence<>'diagnostic_test'
  ),
  all_facts as (select * from views union all select * from commercial union all select * from legacy
    union all select * from operations o where (p_user is null or o.user_id=p_user) and (p_group is null or o.group_id=p_group)),
  facts as (select jsonb_build_object('organizationId',organization_id,'userId',user_id,'groupId',group_id,
      'day',to_char((at_time at time zone 'America/Santiago')::date,'YYYY-MM-DD'),'module',module,'kind',kind,'status',coalesce(status,'unknown'),
      'actor',actor,'count',count(distinct entity),'firstAt',min(at_time),'lastAt',max(at_time),'entityKeys',jsonb_agg(distinct entity)) value
    from all_facts group by organization_id,user_id,group_id,(at_time at time zone 'America/Santiago')::date,module,kind,status,actor),
  journal as (select organization_id,user_id,group_id,quota_day as day,resource,sum(delta)::integer net,
      sum(greatest(delta,0))::integer debits,sum(greatest(-delta,0))::integer refunds
    from public.admin_credit_movements where (organization_id=any(p_orgs) or organization_id is null and p_legacy)
      and quota_day between p_from and p_to and (p_user is null or user_id=p_user) and (p_group is null or group_id=p_group)
    group by organization_id,user_id,group_id,quota_day,resource),
  user_buckets as (select b.*,coalesce(u.mode,o.mode,'user') mode,a.reporting_group_id credit_group
    from public.antonia_daily_credit_buckets b
    left join lateral (select p.mode from public.antonia_credit_policies p where p.organization_id=b.organization_id and p.user_id=b.user_id
      and p.subject_type='user' and p.cancelled_at is null and p.effective_from<=b.quota_day and (p.effective_to is null or p.effective_to>=b.quota_day)
      order by p.effective_from desc,p.created_at desc limit 1) u on true
    left join lateral (select p.mode from public.antonia_credit_policies p where p.organization_id=b.organization_id and p.subject_type='organization'
      and p.cancelled_at is null and p.effective_from<=b.quota_day and (p.effective_to is null or p.effective_to>=b.quota_day)
      order by p.effective_from desc,p.created_at desc limit 1) o on true
    left join lateral (select a.reporting_group_id from public.antonia_credit_team_assignments a where a.organization_id=b.organization_id and a.user_id=b.user_id
      and a.cancelled_at is null and a.effective_from<=b.quota_day and (a.effective_to is null or a.effective_to>=b.quota_day)
      order by a.effective_from desc,a.created_at desc limit 1) a on true
    where b.organization_id=any(p_orgs) and b.bucket_type='user' and b.quota_day between p_from and p_to),
  canonical_buckets as (
    select b.organization_id,b.user_id,b.credit_group group_id,b.quota_day as day,r.resource,r.net from user_buckets b
      cross join lateral (values('search',b.search_count),('enrich',b.enrich_count),('investigate',b.investigate_count)) r(resource,net)
    union all
    select b.organization_id,null::uuid,b.reporting_group_id,b.quota_day,r.resource,
      r.net-coalesce((select sum(m.delta) from public.admin_credit_movements m where m.organization_id=b.organization_id and m.quota_day=b.quota_day
        and m.resource=r.resource and m.group_id=b.reporting_group_id and m.mode='hybrid'),0)::integer
        -coalesce((select sum(greatest(0,(case r.resource when 'search' then u.search_count when 'enrich' then u.enrich_count else u.investigate_count end)
          -coalesce((select sum(m.delta) from public.admin_credit_movements m where m.organization_id=u.organization_id and m.user_id=u.user_id and m.quota_day=u.quota_day and m.resource=r.resource),0)))
        from user_buckets u where u.organization_id=b.organization_id and u.quota_day=b.quota_day and u.mode='hybrid' and u.credit_group=b.reporting_group_id),0)::integer
      from public.antonia_daily_credit_buckets b cross join lateral (values('search',b.search_count),('enrich',b.enrich_count),('investigate',b.investigate_count)) r(resource,net)
      where b.organization_id=any(p_orgs) and b.bucket_type='team' and b.quota_day between p_from and p_to
  ),
  credit_rows as (
    select organization_id,user_id,group_id,day,resource,net,debits,refunds,'journal'::text source from journal
    union all
    select b.organization_id,b.user_id,b.group_id,b.day,b.resource,
      b.net-coalesce((select sum(j.net) from journal j where j.organization_id=b.organization_id and j.day=b.day and j.resource=b.resource
        and (case when b.user_id is null then j.group_id=b.group_id and j.user_id is not null and not exists(select 1 from user_buckets u where u.organization_id=j.organization_id and u.user_id=j.user_id and u.quota_day=j.day)
          else j.user_id=b.user_id end)),0)::integer,null::integer,null::integer,case when b.user_id is null then 'unattributed' else 'counter' end
      from canonical_buckets b where (p_user is null or b.user_id=p_user) and (p_group is null or b.group_id=p_group)
    union all
    select null::uuid,b.user_id,null::uuid,b.date,r.resource,r.net-coalesce((select sum(j.net) from journal j where j.organization_id is null and j.user_id=b.user_id and j.day=b.date and j.resource=r.resource),0)::integer,
      null::integer,null::integer,'unattributed' from public.antonia_user_daily_credits b
      cross join lateral(values('search',b.search_count),('enrich',b.enrich_count),('investigate',b.investigate_count)) r(resource,net)
      where p_legacy and b.date between p_from and p_to and (p_user is null or b.user_id=p_user) and p_group is null
  ),
  credit_values as (select jsonb_build_object('organizationId',organization_id,'userId',user_id,'groupId',group_id,'day',day,'resource',resource,'net',net,
      'debits',debits,'refunds',refunds,'source',source) value from credit_rows where net<>0 or coalesce(debits,0)+coalesce(refunds,0)>0),
  recipients as (select distinct on(c.organization_id,lower(trim(c.email))) c.*,md5(c.organization_id::text||':'||lower(trim(c.email))) recipient_key
      from old_contacts c where c.sent_at>=since_at and c.sent_at<until_at and coalesce(c.data->>'channel','email')<>'linkedin'
      order by c.organization_id,lower(trim(c.email)),c.sent_at,c.user_id,c.id),
  cohort as (select jsonb_build_object('organizationId',c.organization_id,'userId',c.user_id,'recipientKey',c.recipient_key,'sentAt',c.sent_at,
      'replyAt',reply.occurred_at,'intent',reply.intent,'interestedAt',interest.occurred_at,
      'interestReliable',c.sent_at>=(select commercial_from from public.admin_usage_capture) and
        (interest.occurred_at is not null or coalesce(c.reply_sync_succeeded_at,'epoch'::timestamptz)>=c.sent_at+make_interval(days=>p_horizon)),
      'reliable',c.sent_at>=(select commercial_from from public.admin_usage_capture) and
        (reply.intent is not null or coalesce((to_jsonb(c)->>'reply_sync_succeeded_at')::timestamptz,'epoch'::timestamptz)>=c.sent_at+make_interval(days=>p_horizon))) value
    from recipients c left join lateral(select f.occurred_at,f.intent from public.admin_commercial_facts f
      where f.organization_id=c.organization_id and f.entity_key=c.recipient_key and f.kind='reply_observed' and f.module='email' and f.thread_key is not null
        and f.intent in ('positive','meeting_request','neutral','negative','unsubscribe')
        and exists(select 1 from public.admin_commercial_facts sent where sent.organization_id=c.organization_id and sent.entity_key=c.recipient_key
          and sent.kind='contact_sent' and sent.thread_key=f.thread_key and sent.occurred_at=c.sent_at)
        and f.occurred_at>=c.sent_at and f.occurred_at<=c.sent_at+make_interval(days=>p_horizon)
      order by f.occurred_at limit 1) reply on true
    left join lateral(select min(f.occurred_at) occurred_at from public.admin_commercial_facts f where f.organization_id=c.organization_id and f.entity_key=c.recipient_key
      and f.kind='reply_observed' and f.module='email' and f.intent in ('positive','meeting_request') and f.thread_key is not null
      and exists(select 1 from public.admin_commercial_facts sent where sent.organization_id=c.organization_id and sent.entity_key=c.recipient_key
        and sent.kind='contact_sent' and sent.module='email' and sent.thread_key=f.thread_key and sent.occurred_at=c.sent_at)
      and f.occurred_at>=c.sent_at and f.occurred_at<=c.sent_at+make_interval(days=>p_horizon)) interest on true),
  pending_base as (
    select c.organization_id,c.user_id,'positive_pending'::text kind,'/contacted?view=replied'::text href from old_contacts c
      where c.reply_intent in ('positive','meeting_request') and c.replied_at is not null
      and coalesce((to_jsonb(c)->>'conversation_resolved_at')::timestamptz,'epoch'::timestamptz)<c.replied_at
      and coalesce((to_jsonb(c)->>'conversation_outbound_at')::timestamptz,'epoch'::timestamptz)<c.replied_at
    union all
    select c.organization_id,c.user_id,'overdue_commitment','/contacted?view=replied' from old_contacts c
      where public.admin_usage_time(c.data->'commitment'->>'dueAt')<now() and c.data->'commitment'->>'completedAt' is null
    union all
    select d.organization_id,d.user_id,'awaiting_approval','/saved/leads/enriched' from public.messaging_drafts d
      where d.organization_id=any(p_orgs) and d.lifecycle='draft' and (p_user is null or d.user_id=p_user)
      and (p_group is null or exists(select 1 from scope_users s where s.organization_id=d.organization_id and s.user_id=d.user_id))
    union all
    select c.organization_id,c.user_id,'sync_gap','/contacted' from public.contacted_leads c
      where c.organization_id=any(p_orgs) and c.reply_sync_error is not null and (p_user is null or c.user_id=p_user)
      and (p_group is null or exists(select 1 from scope_users s where s.organization_id=c.organization_id and s.user_id=c.user_id))
    union all
    select d.organization_id,d.user_id,case when d.status='unknown' then 'unknown_send' else 'failed_send' end,'/contacted' from public.outbound_dispatches d
      where d.organization_id=any(p_orgs) and d.status in ('unknown','failed') and (p_user is null or d.user_id=p_user)
      and (p_group is null or exists(select 1 from scope_users s where s.organization_id=d.organization_id and s.user_id=d.user_id))
    union all
    select d.organization_id,d.user_id,'prepared_not_contacted','/saved/leads/enriched' from public.messaging_drafts d
      join public.messaging_draft_versions v on v.id=d.current_version_id and v.organization_id=d.organization_id and v.user_id=d.user_id
      where d.organization_id=any(p_orgs) and d.lifecycle='ready' and d.channel='email'
      and not exists(select 1 from public.outbound_dispatches sent where sent.organization_id=d.organization_id and sent.user_id=d.user_id and sent.draft_id=d.id and sent.status='sent')
      and not exists(select 1 from public.contacted_leads c where c.organization_id=d.organization_id and c.user_id=d.user_id and lower(c.email)=lower(v.recipient->>'email') and c.sent_at is not null)
      and (p_user is null or d.user_id=p_user) and (p_group is null or exists(select 1 from scope_users s where s.organization_id=d.organization_id and s.user_id=d.user_id))
    union all
    select m.organization_id,m.user_id,'mail_missing','/connections' from public.organization_members m
      where m.organization_id=any(p_orgs) and not exists(select 1 from public.provider_tokens t where t.user_id=m.user_id and t.provider in ('google','outlook'))
      and exists(select 1 from public.messaging_drafts d where d.organization_id=m.organization_id and d.user_id=m.user_id and d.channel='email' and d.lifecycle<>'archived')
      and (p_user is null or m.user_id=p_user) and (p_group is null or exists(select 1 from scope_users s where s.organization_id=m.organization_id and s.user_id=m.user_id))
    union all
    select m.organization_id,m.user_id,'profile_missing','/profile' from public.organization_members m left join public.profiles profile on profile.id=m.user_id
      where m.organization_id=any(p_orgs)
      and coalesce(nullif(trim(profile.signatures#>>'{profile_extended,valueProposition}'),''),nullif(trim(profile.signatures#>>'{profile_extended,value_proposition}'),''),'')=''
      and coalesce(trim(profile.signatures#>>'{profile_extended,services}'),'') in ('','[]','null')
      and coalesce(trim(profile.signatures#>>'{profile_extended,description}'),'')=''
      and exists(select 1 from public.messaging_drafts d where d.organization_id=m.organization_id and d.user_id=m.user_id and d.channel='email' and d.lifecycle<>'archived')
      and (p_user is null or m.user_id=p_user) and (p_group is null or exists(select 1 from scope_users s where s.organization_id=m.organization_id and s.user_id=m.user_id))
    union all
    select s.organization_id,s.user_id,'safety_hold','/campaigns' from public.campaign_recipient_steps s
      where s.organization_id=any(p_orgs) and s.state in ('blocked','stopped') and s.last_error in ('recipient_suppressed','company_replied','negotiation_hold','recipient_replied','unsubscribed')
      and (p_user is null or s.user_id=p_user) and (p_group is null or exists(select 1 from scope_users u where u.organization_id=s.organization_id and u.user_id=s.user_id))
  ),
  pending as (select jsonb_build_object('organizationId',organization_id,'userId',user_id,'kind',kind,'href',href,'count',count(*)) value
    from pending_base group by organization_id,user_id,kind,href)
  select jsonb_build_object('facts',coalesce((select jsonb_agg(value) from facts),'[]'::jsonb),
    'credits',coalesce((select jsonb_agg(value) from credit_values),'[]'::jsonb),
    'cohort',coalesce((select jsonb_agg(value) from cohort),'[]'::jsonb),
    'pending',coalesce((select jsonb_agg(value) from pending),'[]'::jsonb),
    'captureFrom',(select activity_from from public.admin_usage_capture),'journalFrom',(select credit_from from public.admin_usage_capture),
    'legacyReplies',(select count(*) from old_contacts c where c.replied_at>=since_at and c.replied_at<until_at and c.sent_at<(select commercial_from from public.admin_usage_capture))) into result;
  return result;
end; $$;
revoke all on function public.admin_usage_report_v1(uuid[],date,date,uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.admin_usage_report_v1(uuid[],date,date,uuid,uuid,integer,boolean) to service_role;
notify pgrst,'reload schema';
