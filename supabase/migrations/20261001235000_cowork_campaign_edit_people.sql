-- Plan 5, PR-6: a Cowork campaign carries a first email written for each person (the definition's
-- `overrides`, the same field the manual campaign uses), and the person can edit that email before
-- approving it. cowork_edit_campaign_definition (M4, with the access rule of M5) refused any change
-- outside the subjects and bodies of the template emails, so editing one person's email was refused.
--
-- This replaces it with the same function, same locks, checks and event, that also accepts changes to
-- the overrides: each one is {email, messageIndex, subject, body} for a recipient of the campaign and an
-- email that exists, without duplicates, with a subject and a body with text. Recipients, the number of
-- emails, their spacing and the rest of the definition still cannot change. The app before this change
-- only changes the template emails, which stays allowed.

create or replace function public.cowork_edit_campaign_definition(
  p_run_id uuid, p_user_id uuid, p_organization_id uuid, p_expected jsonb, p_definition jsonb, p_changed integer[])
returns text language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals; d public.cowork_campaign_definitions; steps integer; overrides jsonb;
begin
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=p_user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null and m.organization_id=p_organization_id) then
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

  -- Only subjects and bodies change: of the template emails and of each person's own email.
  if (p_definition-'messages'-'overrides') is distinct from (d.definition-'messages'-'overrides')
    or jsonb_typeof(d.definition->'messages') is distinct from 'array'
    or steps<>jsonb_array_length(d.definition->'messages')
    or exists(select 1 from jsonb_array_elements(d.definition->'messages') with ordinality before(m, i)
      join jsonb_array_elements(p_definition->'messages') with ordinality after(m, i) on after.i=before.i
      where (before.m-'subject'-'body') is distinct from (after.m-'subject'-'body')) then
    raise exception 'Only the subjects and bodies of the emails can change' using errcode='22023';
  end if;

  -- Each person's own email: a recipient of this campaign, an email that exists, once, with text.
  overrides := coalesce(p_definition->'overrides', '[]'::jsonb);
  if jsonb_typeof(overrides)<>'array'
    or exists(select 1 from jsonb_array_elements(overrides) o where jsonb_typeof(o) is distinct from 'object') then
    raise exception 'Invalid email of a person' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(overrides) o
    where (select array_agg(k order by k collate "C") from jsonb_object_keys(o) k) is distinct from array['body','email','messageIndex','subject']
      or jsonb_typeof(o->'email') is distinct from 'string' or jsonb_typeof(o->'messageIndex') is distinct from 'number'
      or jsonb_typeof(o->'subject') is distinct from 'string' or jsonb_typeof(o->'body') is distinct from 'string') then
    raise exception 'Invalid email of a person' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(overrides) o
    where jsonb_typeof(p_definition->'emails') is distinct from 'array' or not ((p_definition->'emails') ? (o->>'email'))
      or (o->'messageIndex')::numeric<>trunc((o->'messageIndex')::numeric)
      or (o->'messageIndex')::numeric<0 or (o->'messageIndex')::numeric>=steps
      or btrim(o->>'subject')='' or btrim(o->>'body')='')
    or (select count(*) from jsonb_array_elements(overrides))
      <>(select count(distinct (o->>'email')||':'||(o->>'messageIndex')) from jsonb_array_elements(overrides) o) then
    raise exception 'Invalid email of a person' using errcode='22023';
  end if;

  update public.cowork_campaign_definitions set definition=p_definition where run_id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'proposal.edited',
      jsonb_build_object('kind','campaign_create','emails',(select to_jsonb(array_agg(distinct c order by c)) from unnest(p_changed) c)));
  return 'edited';
end; $$;
revoke all on function public.cowork_edit_campaign_definition(uuid,uuid,uuid,jsonb,jsonb,integer[]) from public,anon,authenticated;
grant execute on function public.cowork_edit_campaign_definition(uuid,uuid,uuid,jsonb,jsonb,integer[]) to service_role;
