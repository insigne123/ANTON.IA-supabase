-- Remote ledger: 20260922223501. Owner-scoped merge preserves contact metadata.
create or replace function public.update_contacted_work(p_org uuid,p_user uuid,p_contact text,p_kind text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contacted_leads; v jsonb; due timestamptz;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  select * into c from public.contacted_leads where id=p_contact and organization_id=p_org and user_id=p_user for update;
  if not found then raise exception 'contact unavailable' using errcode='42501'; end if;
  if p_kind='commitment' then
    if jsonb_typeof(p_value)<>'object' or coalesce(p_value->>'kind','') not in ('call','meeting','reminder')
      or length(trim(coalesce(p_value->>'title',''))) not between 1 and 300 then raise exception 'invalid commitment'; end if;
    due := (p_value->>'dueAt')::timestamptz;
    if due is null or due<now() then raise exception 'choose a future date'; end if;
    v := jsonb_build_object('id',gen_random_uuid(),'kind',p_value->>'kind','title',trim(p_value->>'title'),'dueAt',due,'ownerId',p_user,'completedAt',null,'updatedAt',now());
  elsif p_kind='complete' then
    v := c.data->'commitment';
    if v is null or v->>'id' is distinct from p_value->>'id' then raise exception 'commitment changed'; end if;
    v := v || jsonb_build_object('completedAt',now(),'updatedAt',now());
    p_kind := 'commitment';
  elsif p_kind='advice' then
    if coalesce(p_value->>'replyId','') <> coalesce(c.reply_message_id,'') or c.replied_at is null then raise exception 'reply changed'; end if;
    v := p_value;
  elsif p_kind='replyDraft' then
    if length(coalesce(p_value->>'body',''))>12000 then raise exception 'reply too long'; end if;
    v := p_value;
  else raise exception 'invalid action'; end if;
  update public.contacted_leads set data=coalesce(data,'{}'::jsonb)||jsonb_build_object(p_kind,v) where id=p_contact;
  return v;
end; $$;
revoke all on function public.update_contacted_work(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.update_contacted_work(uuid,uuid,text,text,jsonb) to service_role;

-- Lock the same step as automatic claim. An in-flight/uncertain send cannot be
-- rescheduled; stopped enrollments cannot be silently reactivated.
create or replace function public.reschedule_contacted_step(p_org uuid,p_user uuid,p_step uuid,p_due timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare s public.campaign_recipient_steps; e public.campaign_enrollments;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if p_due is null or p_due<=now() then raise exception 'choose a future date'; end if;
  select * into s from public.campaign_recipient_steps where id=p_step and organization_id=p_org and user_id=p_user for update;
  if not found or s.step_index<1 or s.state not in ('not_due','review_required','approved','deferred') or s.outbound_dispatch_id is not null then raise exception 'step unavailable or already dispatched'; end if;
  select * into e from public.campaign_enrollments where id=s.enrollment_id;
  if e.status<>'active' then raise exception 'enrollment is not active'; end if;
  if exists(select 1 from public.contacted_leads c where c.organization_id=p_org and lower(c.email)=lower(e.recipient_email) and c.replied_at is not null) then raise exception 'recipient replied'; end if;
  update public.campaign_recipient_steps set due_at=p_due,updated_at=now() where id=p_step;
end; $$;
revoke all on function public.reschedule_contacted_step(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.reschedule_contacted_step(uuid,uuid,uuid,timestamptz) to service_role;
