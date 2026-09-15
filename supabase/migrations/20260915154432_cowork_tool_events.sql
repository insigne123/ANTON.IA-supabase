-- Version aligned with production migration ledger.
create function public.cowork_record_tool_result(p_run_id uuid, p_token uuid, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare candidate public.cowork_runs;
begin
  select r.* into candidate from public.cowork_runs r
    where r.id = p_run_id and r.status = 'running' and r.lease_token = p_token and r.lease_expires_at > now()
      and exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
        where g.user_id = r.user_id and g.enabled and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null)
      and exists (select 1 from public.organization_members m where m.user_id = r.user_id and m.organization_id = r.organization_id)
    for update of r;
  if not found then return false; end if;
  insert into public.cowork_run_events(run_id, user_id, organization_id, kind, payload)
    values (candidate.id, candidate.user_id, candidate.organization_id, 'tool.completed', p_payload);
  return true;
end;
$$;
revoke all on function public.cowork_record_tool_result(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cowork_record_tool_result(uuid, uuid, jsonb) to service_role;
