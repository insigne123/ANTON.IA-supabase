-- Plan 5, PR-9a: a contact who never replied is free for the team again 30 days after the last send.
-- Until now an active contact thread stayed with its first sender forever: only an owner or admin could reopen it,
-- and only after 90 days (reopen_organization_contact_thread_v1). This releases, in bounded batches, the active email
-- threads whose last send is 30 or more days old, with no dispatch in flight and no reply from the recipient in this
-- cycle. A reply keeps the thread with its owner until the conversation is closed (close_organization_contact_thread_v1).
-- The release is recorded like a reopen (reopened_at marks where the next cycle starts) and as a contact.released
-- event. Only the service role runs it: the outbound reconciliation job calls it.
create or replace function public.release_idle_organization_contact_threads_v1(
  p_now timestamptz default now(),
  p_limit integer default 200
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread public.organization_contact_threads%rowtype;
  v_released integer := 0;
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'Invalid release window' using errcode = '22023';
  end if;

  for v_thread in
    select t.*
    from public.organization_contact_threads t
    where t.channel = 'email'
      and t.status = 'active'
      and t.reserved_dispatch_id is null
      and t.last_contacted_at <= p_now - interval '30 days'
      and exists (
        select 1 from public.organizations o
        where o.id = t.organization_id and o.collaboration_v1_enabled
      )
      and not exists (
        select 1 from public.contacted_leads cl
        where cl.organization_id = t.organization_id
          and lower(trim(cl.email)) = t.recipient_email
          and cl.replied_at >= coalesce(t.reopened_at, t.first_contacted_at, '-infinity'::timestamptz)
      )
    order by t.last_contacted_at
    limit p_limit
    for update of t skip locked
  loop
    update public.organization_contact_threads
    set status = 'available',
        active_lead_id = null,
        active_campaign_id = null,
        opened_by_user_id = null,
        root_dispatch_id = null,
        closed_at = p_now,
        reopened_at = p_now,
        reopened_by_user_id = null,
        reopen_reason = 'Libre para el equipo: 30 días sin respuesta desde el último envío.',
        updated_at = p_now
    where id = v_thread.id;

    perform public.append_organization_collaboration_event_v1(
      v_thread.organization_id, null, 'contact.released', 'contact_thread', v_thread.id::text,
      v_thread.active_lead_id, v_thread.id,
      jsonb_build_object(
        'reason', 'no_reply_30_days',
        'lastContactedAt', v_thread.last_contacted_at,
        'previousOwnerUserId', v_thread.opened_by_user_id,
        'previousRootDispatchId', v_thread.root_dispatch_id
      )
    );
    v_released := v_released + 1;
  end loop;

  return v_released;
end;
$$;

revoke all on function public.release_idle_organization_contact_threads_v1(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.release_idle_organization_contact_threads_v1(timestamptz, integer) to service_role;

notify pgrst, 'reload schema';
