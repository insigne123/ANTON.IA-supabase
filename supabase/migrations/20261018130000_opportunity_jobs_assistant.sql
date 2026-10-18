-- One more kind of opportunity work: «assistant», the answer of the section's general conversation
-- (opportunity_assistant_messages), run by the same worker and budget as the chat of an opportunity.
alter table public.opportunity_jobs drop constraint if exists opportunity_jobs_kind_check;
alter table public.opportunity_jobs add constraint opportunity_jobs_kind_check
  check (kind in ('criteria','tenders','hiring','posts','evaluate','research','chat','offer','demand','assistant'));

-- The worker also takes the assistant's answer of a member (it has no opportunity; the job reads only what that person
-- can see), and answers it as soon as a chat question.
create or replace function public.opportunity_claim_job() returns setof public.opportunity_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 select j.id into v_id from public.opportunity_jobs j where (j.state in ('queued','waiting') or (j.state='running' and j.lease_until<now()))
  and j.attempts<100 and (j.state<>'waiting' or j.updated_at<now()-interval '45 seconds')
  and exists(select 1 from public.organization_members m where m.organization_id=j.organization_id and m.user_id=j.requested_by
    and (m.role in ('admin','owner') or j.kind='assistant' or (j.opportunity_id is not null and public.opportunity_can_read(j.organization_id,j.requested_by,j.opportunity_id))))
 order by case j.kind when 'chat' then 0 when 'assistant' then 0 when 'research' then 1 when 'criteria' then 2 else 3 end,j.updated_at,j.created_at for update skip locked limit 1;
 if v_id is null then return; end if;
 return query update public.opportunity_jobs set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now()
  where id=v_id returning *;
end $$;
revoke all on function public.opportunity_claim_job() from public,anon,authenticated;
grant execute on function public.opportunity_claim_job() to service_role;

notify pgrst, 'reload schema';
