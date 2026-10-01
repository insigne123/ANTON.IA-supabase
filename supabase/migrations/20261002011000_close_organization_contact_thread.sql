-- Plan 5, PR-9a: «Cerrar conversación». Before this, «Marcar resuelto» only hid the conversation for its sender and
-- released nobody. The owner of an active contact thread (or an owner or admin of the organization) now closes it with
-- an outcome, recorded as a contact.closed event:
--   no_deal         Sin acuerdo    -> available: free for the team (recorded like a reopen, which starts a new cycle)
--   won             Ganado         -> closed: nobody prospects them again until an owner or admin reopens it
--   not_interested  No interesado  -> suppressed: nobody in the organization contacts them again
--   keep            Lo retomo yo   -> stays active with its owner
create or replace function public.close_organization_contact_thread_v1(
  p_contact_thread_id uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread public.organization_contact_threads%rowtype;
  v_outcome text := lower(trim(coalesce(p_outcome, '')));
  v_lead_id uuid;
  v_previous_owner uuid;
begin
  if v_outcome not in ('no_deal', 'won', 'not_interested', 'keep') then
    raise exception 'Invalid close outcome' using errcode = '22023';
  end if;

  select * into v_thread from public.organization_contact_threads
  where id = p_contact_thread_id for update;
  if not found then raise exception 'Contact thread not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = v_thread.organization_id and o.collaboration_v1_enabled
  ) then
    raise exception 'Organization collaboration is not enabled' using errcode = '55000';
  end if;
  if auth.uid() is null or not (
    public.organization_has_role_v1(v_thread.organization_id, array['owner', 'admin'])
    or (
      v_thread.opened_by_user_id = auth.uid()
      and public.organization_has_role_v1(v_thread.organization_id, array['member'])
    )
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_thread.status <> 'active' then
    raise exception 'Only an active contact thread can be closed' using errcode = '55000';
  end if;
  if v_thread.reserved_dispatch_id is not null then
    raise exception 'Contact thread has an in-flight dispatch' using errcode = '55000';
  end if;

  v_lead_id := v_thread.active_lead_id;
  v_previous_owner := v_thread.opened_by_user_id;
  if v_outcome = 'no_deal' then
    update public.organization_contact_threads
    set status = 'available',
        active_lead_id = null,
        active_campaign_id = null,
        opened_by_user_id = null,
        root_dispatch_id = null,
        closed_at = now(),
        reopened_at = now(),
        reopened_by_user_id = auth.uid(),
        reopen_reason = 'Conversación cerrada sin acuerdo: libre para el equipo.',
        updated_at = now()
    where id = v_thread.id
    returning * into v_thread;
  elsif v_outcome = 'won' then
    update public.organization_contact_threads
    set status = 'closed', closed_at = now(), updated_at = now()
    where id = v_thread.id
    returning * into v_thread;
  elsif v_outcome = 'not_interested' then
    update public.organization_contact_threads
    set status = 'suppressed', closed_at = now(), updated_at = now()
    where id = v_thread.id
    returning * into v_thread;
  end if;

  perform public.append_organization_collaboration_event_v1(
    v_thread.organization_id, auth.uid(), 'contact.closed', 'contact_thread', v_thread.id::text,
    v_lead_id, v_thread.id,
    jsonb_build_object('outcome', v_outcome, 'status', v_thread.status, 'previousOwnerUserId', v_previous_owner)
  );
  return to_jsonb(v_thread);
end;
$$;

revoke all on function public.close_organization_contact_thread_v1(uuid, text) from public, anon;
grant execute on function public.close_organization_contact_thread_v1(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
