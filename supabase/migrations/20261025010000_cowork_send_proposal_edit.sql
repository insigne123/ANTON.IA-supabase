-- COW-29: the person corrects the email of «Aprobar y enviar» in the card instead of asking Cowork for a whole new version.
-- The app saves the correction as a new human revision of the draft (reviseNativeDraft) and then calls this function, which
-- moves the proposal to that revision in one transaction with the approval machinery, as cowork_edit_campaign_definition does
-- for campaigns. It takes the same locks as cowork_resolve_effect (the run, then its proposal) and:
--   * moves only a «send_email» proposal that is still «proposed» while its run waits for approval;
--   * moves only from the target the person saw (p_expected), so two tabs never overwrite each other;
--   * keeps the draft, the mailbox and the sender of the target: only the version and the hash of its content change, so
--     the email still goes to the same person from the same account, and the send checks them again before it goes;
--   * records «proposal.edited» without the text.
-- With p_target null it only says whether the proposal can be edited now ('ready'), so the card offers «Editar» only then.
-- It only adds a function. Until it exists the app does not offer editing.

create function public.cowork_edit_send_proposal(
  p_run_id uuid, p_user_id uuid, p_organization_id uuid, p_expected text, p_target text, p_label text)
returns text language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals;
begin
  -- The same access rule as cowork_resolve_effect.
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=p_user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null and m.organization_id=p_organization_id) then
    return 'forbidden';
  end if;
  -- draft:version:contentHash:provider:senderHash, as the worker writes it (src/lib/server/cowork/send-email.ts).
  if p_expected is null or array_length(string_to_array(p_expected, ':'), 1)<>5 then
    raise exception 'Invalid send target' using errcode='22023';
  end if;
  if p_target is not null then
    if array_length(string_to_array(p_target, ':'), 1)<>5 or length(p_target)>300 then
      raise exception 'Invalid send target' using errcode='22023';
    end if;
    if split_part(p_target, ':', 1)<>split_part(p_expected, ':', 1) or split_part(p_target, ':', 4)<>split_part(p_expected, ':', 4)
      or split_part(p_target, ':', 5)<>split_part(p_expected, ':', 5) then
      raise exception 'Only the version of the draft can change' using errcode='22023';
    end if;
    if p_label is null or length(btrim(p_label)) not between 1 and 280 then
      raise exception 'Invalid label' using errcode='22023';
    end if;
  end if;

  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return 'not_found'; end if;
  select * into p from public.cowork_effect_proposals where run_id=r.id for update;
  if not found or p.kind<>'send_email' or p.status<>'proposed' or r.status<>'waiting_approval' then return 'not_pending'; end if;
  if p.target_id<>p_expected then return 'stale'; end if;
  if p_target is null then return 'ready'; end if;

  update public.cowork_effect_proposals set target_id=p_target, label=p_label, updated_at=now() where run_id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'proposal.edited',jsonb_build_object('kind','send_email'));
  return 'edited';
end; $$;
revoke all on function public.cowork_edit_send_proposal(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.cowork_edit_send_proposal(uuid,uuid,uuid,text,text,text) to service_role;
