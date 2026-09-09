-- Forward-only. Approval freezes the audience and all rendered messages atomically.
create table public.bulk_campaigns (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  status text not null default 'draft' check (status in ('draft','rejected','approved','paused')),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  recipients jsonb not null check (jsonb_typeof(recipients) = 'array' and jsonb_array_length(recipients) between 1 and 100),
  review_hash text not null check (review_hash ~ '^[a-f0-9]{64}$'),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('approved','paused')) = (approved_at is not null))
);
create index bulk_campaigns_owner_idx on public.bulk_campaigns(organization_id, user_id, created_at desc);
alter table public.bulk_campaigns enable row level security;
create policy bulk_campaigns_owner_read on public.bulk_campaigns for select to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.organization_members om where om.organization_id = bulk_campaigns.organization_id and om.user_id = auth.uid()
  ));
revoke all on public.bulk_campaigns from anon, authenticated;
grant select on public.bulk_campaigns to authenticated;
grant all on public.bulk_campaigns to service_role;

create function public.mutate_bulk_campaign_v1(
  p_id uuid, p_organization_id uuid, p_user_id uuid, p_action text,
  p_expected_revision integer, p_review_hash text, p_definition jsonb default null,
  p_recipients jsonb default null, p_drafts jsonb default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.bulk_campaigns%rowtype;
  v_item jsonb;
  v_payload jsonb;
  v_count integer;
  v_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' or not exists (
    select 1 from public.organization_members where organization_id = p_organization_id and user_id = p_user_id
  ) then raise exception 'not authorized' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bulk-campaign:' || p_id::text, 0));
  select * into v_campaign from public.bulk_campaigns where id = p_id for update;
  if p_action = 'save' and v_campaign.id is null then
    if p_expected_revision <> 0 then raise exception 'CAMPAIGN_VERSION_CONFLICT' using errcode = '40001'; end if;
    insert into public.bulk_campaigns(id, organization_id, user_id, definition, recipients, review_hash)
      values(p_id, p_organization_id, p_user_id, p_definition, p_recipients, p_review_hash) returning * into v_campaign;
    return to_jsonb(v_campaign);
  end if;
  if v_campaign.id is null or v_campaign.organization_id <> p_organization_id or v_campaign.user_id <> p_user_id then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = '42501';
  end if;
  if v_campaign.revision <> p_expected_revision then raise exception 'CAMPAIGN_VERSION_CONFLICT' using errcode = '40001'; end if;
  if p_action = 'save' then
    if v_campaign.status not in ('draft','rejected') then raise exception 'CAMPAIGN_FROZEN'; end if;
    update public.bulk_campaigns set definition = p_definition, recipients = p_recipients, review_hash = p_review_hash,
      revision = revision + 1, status = 'draft', updated_at = now() where id = p_id returning * into v_campaign;
  elsif p_action in ('approve','reject') then
    if v_campaign.review_hash is distinct from p_review_hash then raise exception 'CAMPAIGN_VERSION_CONFLICT' using errcode = '40001'; end if;
    if p_action = 'approve' and v_campaign.status = 'approved' then return to_jsonb(v_campaign); end if;
    if v_campaign.status not in ('draft','rejected') then raise exception 'CAMPAIGN_FROZEN'; end if;
    if p_action = 'approve' then
      select count(*) into v_count from jsonb_array_elements(v_campaign.recipients) r, jsonb_array_elements(r->'messages') m;
      if p_drafts is null or jsonb_typeof(p_drafts) <> 'array' or jsonb_array_length(p_drafts) <> v_count then raise exception 'INVALID_APPROVAL'; end if;
      for v_item in select value from jsonb_array_elements(p_drafts) loop
        v_payload := v_item->'payload';
        if v_payload->>'organizationId' is distinct from p_organization_id::text
          or v_payload->>'userId' is distinct from p_user_id::text
          or v_payload#>>'{approval,decidedBy}' is distinct from p_user_id::text
          or v_payload#>>'{approval,status}' is distinct from 'approved'
          or v_payload->>'lifecycle' is distinct from 'ready'
          or not exists (
            select 1 from jsonb_array_elements(v_campaign.recipients) r, jsonb_array_elements(r->'messages') m
            where r->>'email' = v_payload#>>'{recipient,email}' and m->>'draftId' = v_payload->>'draftId'
              and m->>'versionId' = v_payload->>'versionId' and m->>'subject' = v_payload#>>'{content,subject}'
              and m->>'body' = v_payload#>>'{content,text}' and v_payload#>'{content,html}' = 'null'::jsonb
          ) then raise exception 'INVALID_APPROVAL'; end if;
        -- Re-approval after a pending revision reuses already-created locked drafts.
        select mv.content_hash into v_hash from public.messaging_draft_versions mv
          where mv.id = (v_payload->>'versionId')::uuid;
        if found then
          if v_hash is distinct from v_item->>'hash' then raise exception 'INVALID_APPROVAL'; end if;
        else
          perform public.create_messaging_draft_v1(v_payload, v_item->>'hash');
        end if;
      end loop;
    end if;
    update public.bulk_campaigns set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
      approved_at = case when p_action = 'approve' then now() else null end, updated_at = now()
      where id = p_id returning * into v_campaign;
  elsif (p_action = 'pause' and v_campaign.status = 'approved') or (p_action = 'resume' and v_campaign.status = 'paused') then
    update public.bulk_campaigns set status = case when p_action = 'pause' then 'paused' else 'approved' end,
      updated_at = now() where id = p_id returning * into v_campaign;
  else raise exception 'INVALID_CAMPAIGN_ACTION'; end if;
  return to_jsonb(v_campaign);
end;
$$;
revoke all on function public.mutate_bulk_campaign_v1(uuid,uuid,uuid,text,integer,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.mutate_bulk_campaign_v1(uuid,uuid,uuid,text,integer,text,jsonb,jsonb,jsonb) to service_role;
