-- Applied via MCP as 20260921022150. Usage survives completion, approval and failed synthesis. No refund of
-- reservations; missing provider telemetry remains unknown, never zero.
alter table public.cowork_model_calls add column usage jsonb,
  add column usage_recorded_at timestamptz;
create function public.cowork_record_model_usage(p_id uuid,p_token uuid,p_usage jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.cowork_model_calls; r public.cowork_runs; parent_id uuid; deadline timestamptz;
begin
  if jsonb_typeof(p_usage) is distinct from 'object' or octet_length(p_usage::text)>4000 then
    raise exception 'Invalid usage'; end if;
  select run_id into parent_id from public.cowork_model_calls where id=p_id;
  if not found then return false; end if;
  select * into r from public.cowork_runs where id=parent_id for update;
  deadline:=public.cowork_attempt_deadline(parent_id,p_token);
  if deadline is null or deadline<=clock_timestamp() then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
    and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
    and m.organization_id=r.organization_id) then return false; end if;
  select * into c from public.cowork_model_calls where id=p_id for update;
  if c.user_id<>r.user_id or c.organization_id<>r.organization_id then return false; end if;
  if c.role='coordinator' and (r.status<>'running' or r.lease_token is distinct from p_token) then return false; end if;
  if c.role<>'coordinator' and not exists(select 1 from public.cowork_specialist_tasks
    where run_id=r.id and role=c.role and status='executing' and lease_token=p_token) then return false; end if;
  if c.usage_recorded_at is not null then return c.usage=p_usage; end if;
  update public.cowork_model_calls set usage=p_usage,usage_recorded_at=clock_timestamp() where id=c.id;
  return true;
end; $$;
revoke all on function public.cowork_record_model_usage(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cowork_record_model_usage(uuid,uuid,jsonb) to service_role;
