-- M4 (plan 2): the person edits the emails of a proposed campaign in one step with the approval
-- machinery. Today the app checks that the proposal is still pending and then writes the definition
-- in a second statement: an approval landing between the two can create the campaign from one
-- version while the trace says it was edited, or the edit can land after the approval. This
-- function takes the same locks as cowork_resolve_effect (the run, then its proposal), then the
-- definition, and inside that one transaction:
--   * edits only while the proposal is still «proposed» and the run waits for approval;
--   * edits only the version the person saw (p_expected), so two tabs never overwrite each other;
--   * changes only subjects and bodies: recipients, the number of emails, their spacing and the rest
--     of the definition stay as reviewed, so the approval card stays true;
--   * records the «proposal.edited» event without the text, as the app does today.
-- It only adds a function; nothing calls it until the app switches to it in its own PR.

create function public.cowork_edit_campaign_definition(
  p_run_id uuid, p_user_id uuid, p_organization_id uuid, p_expected jsonb, p_definition jsonb, p_changed integer[])
returns text language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals; d public.cowork_campaign_definitions; steps integer;
begin
  -- The same access rule as the rest of Cowork's functions (cowork_resolve_effect).
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=p_user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=p_organization_id) then
    return 'forbidden';
  end if;
  if p_definition is null or jsonb_typeof(p_definition)<>'object' or jsonb_typeof(p_definition->'messages') is distinct from 'array'
    or octet_length(p_definition::text)>1048576 then
    raise exception 'Invalid campaign definition' using errcode='22023';
  end if;
  steps := jsonb_array_length(p_definition->'messages');
  if p_changed is null or cardinality(p_changed)=0 or exists(select 1 from unnest(p_changed) c where c is null or c<1 or c>steps) then
    raise exception 'Invalid changed emails' using errcode='22023';
  end if;
  -- Every email keeps a subject and a body with text.
  if exists(select 1 from jsonb_array_elements(p_definition->'messages') m
    where jsonb_typeof(m->'subject') is distinct from 'string' or jsonb_typeof(m->'body') is distinct from 'string'
      or btrim(m->>'subject')='' or btrim(m->>'body')='') then
    raise exception 'Every email needs a subject and a body' using errcode='22023';
  end if;

  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return 'not_found'; end if;
  select * into p from public.cowork_effect_proposals where run_id=r.id for update;
  if not found or p.kind<>'campaign_create' or p.status<>'proposed' or r.status<>'waiting_approval' then return 'not_pending'; end if;
  select * into d from public.cowork_campaign_definitions where run_id=r.id and user_id=r.user_id and organization_id=r.organization_id for update;
  if not found then return 'not_pending'; end if;
  if d.definition is distinct from p_expected then return 'stale'; end if;

  -- Only subjects and bodies change.
  if (p_definition-'messages') is distinct from (d.definition-'messages')
    or jsonb_typeof(d.definition->'messages') is distinct from 'array'
    or steps<>jsonb_array_length(d.definition->'messages')
    or exists(select 1 from jsonb_array_elements(d.definition->'messages') with ordinality before(m, i)
      join jsonb_array_elements(p_definition->'messages') with ordinality after(m, i) on after.i=before.i
      where (before.m-'subject'-'body') is distinct from (after.m-'subject'-'body')) then
    raise exception 'Only the subjects and bodies of the emails can change' using errcode='22023';
  end if;

  update public.cowork_campaign_definitions set definition=p_definition where run_id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'proposal.edited',
      jsonb_build_object('kind','campaign_create','emails',(select to_jsonb(array_agg(distinct c order by c)) from unnest(p_changed) c)));
  return 'edited';
end; $$;
revoke all on function public.cowork_edit_campaign_definition(uuid,uuid,uuid,jsonb,jsonb,integer[]) from public,anon,authenticated;
grant execute on function public.cowork_edit_campaign_definition(uuid,uuid,uuid,jsonb,jsonb,integer[]) to service_role;
