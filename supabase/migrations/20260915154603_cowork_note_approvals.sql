-- Version aligned with production migration ledger.
create table public.cowork_note_proposals (
  run_id uuid primary key,
  user_id uuid not null,
  organization_id uuid not null,
  lead_id uuid not null,
  crm_id text not null,
  previous_note text,
  proposed_note text not null check (length(trim(proposed_note)) between 1 and 4000),
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  foreign key (run_id, user_id, organization_id) references public.cowork_runs(id, user_id, organization_id)
);
alter table public.cowork_note_proposals enable row level security;
revoke all on public.cowork_note_proposals from anon, authenticated;
grant select on public.cowork_note_proposals to authenticated;
grant all on public.cowork_note_proposals to service_role;
create policy cowork_note_private_read on public.cowork_note_proposals for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));

create function public.cowork_propose_note(p_run_id uuid, p_token uuid, p_lead_id uuid, p_note text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.cowork_runs; old_note text; target_id text; target_name text;
begin
  select * into r from public.cowork_runs where id = p_run_id and status = 'running'
    and lease_token = p_token and lease_expires_at > now() for update;
  if not found then return false; end if;
  if not exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id
    where g.user_id = r.user_id and g.enabled and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl'
    and u.email_confirmed_at is not null and m.organization_id = r.organization_id) then return false; end if;
  select name into target_name from public.leads where id::text = p_lead_id::text and user_id = r.user_id and organization_id = r.organization_id;
  if not found then raise exception 'Contact unavailable' using errcode = '42501'; end if;
  target_id := 'lead_saved|' || p_lead_id::text;
  select notes into old_note from public.unified_crm_data where id = target_id and organization_id = r.organization_id for update;
  -- First release only edits an existing saved-contact CRM entry.
  if not found then raise exception 'CRM entry unavailable' using errcode = '22023'; end if;
  insert into public.cowork_note_proposals(run_id,user_id,organization_id,lead_id,crm_id,previous_note,proposed_note)
    values(r.id,r.user_id,r.organization_id,p_lead_id,target_id,old_note,p_note);
  update public.cowork_runs set status = 'waiting_approval',lease_token = null,lease_expires_at = null,updated_at = now() where id = r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'approval.requested',jsonb_build_object('action','crm.replace_note','leadId',p_lead_id,'leadName',target_name,'previousNote',old_note,'proposedNote',p_note));
  return true;
end;
$$;

create function public.cowork_resolve_note(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_approve boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.cowork_runs; p public.cowork_note_proposals; current_note text;
begin
  if not exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id
    where g.user_id = p_user_id and g.enabled and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl'
    and u.email_confirmed_at is not null and m.organization_id = p_organization_id) then return false; end if;
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return false; end if;
  select * into p from public.cowork_note_proposals where run_id=r.id for update;
  if not found then return false; end if;
  if p.status='applied' then return p_approve; end if;
  if p.status='rejected' then return not p_approve; end if;
  if r.status <> 'waiting_approval' then return false; end if;
  if p_approve then
    perform 1 from public.leads where id::text=p.lead_id::text and user_id=p_user_id and organization_id=p_organization_id for share;
    if not found then return false; end if;
    select notes into current_note from public.unified_crm_data where id=p.crm_id and organization_id=p_organization_id for update;
    if not found or current_note is distinct from p.previous_note then raise exception 'Note changed; create a new proposal' using errcode='40001'; end if;
    update public.unified_crm_data set notes=p.proposed_note,updated_at=now() where id=p.crm_id and organization_id=p_organization_id;
  end if;
  update public.cowork_note_proposals set status=case when p_approve then 'applied' else 'rejected' end where run_id=r.id;
  update public.cowork_runs set status='completed',updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'run.completed',jsonb_build_object('reply',case when p_approve then 'Nota comercial actualizada en el CRM.' else 'Cambio descartado. La nota no se modificó.' end,'document',null,'action','crm.replace_note','applied',p_approve));
  return true;
end;
$$;
revoke all on function public.cowork_propose_note(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.cowork_resolve_note(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.cowork_propose_note(uuid,uuid,uuid,text) to service_role;
grant execute on function public.cowork_resolve_note(uuid,uuid,uuid,boolean) to service_role;
