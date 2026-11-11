-- Brings a database built from this repository to the shape production has (schema comparison of 2026-11-11, finding O2).
-- Production got these objects before its changes were kept as migrations, or from an earlier text of a migration, so the tests
-- ran against a laxer schema than the one people use: that is how replies stopped being stored for a week without a red test.
-- In production every object below already exists: the first check returns and nothing is touched.
do $reconcile$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.contacted_leads'::regclass and conname = 'contacted_leads_status_check'
  ) then
    return;
  end if;

  -- contacted_leads: the values production accepts, and its indexes.
  alter table public.contacted_leads alter column last_step_idx set default 0;
  alter table public.contacted_leads
    add constraint contacted_leads_mission_id_fkey foreign key (mission_id) references public.antonia_missions(id) on delete set null,
    add constraint contacted_leads_provider_check check (provider = any (array['gmail'::text, 'outlook'::text, 'linkedin'::text, 'phone'::text])),
    add constraint contacted_leads_status_check check (status = any (array['sent'::text, 'replied'::text, 'scheduled'::text, 'failed'::text, 'queued'::text]));
  create index idx_contacted_leads_message_id on public.contacted_leads using btree (message_id);
  create index idx_contacted_leads_thread_id on public.contacted_leads using btree (thread_id);
  drop index public.contacted_leads_reply_message_id_idx;

  -- lead_responses: the link to the lead is a uuid that must exist in leads.
  alter table public.lead_responses
    alter column created_at drop not null,
    alter column id set default extensions.uuid_generate_v4(),
    alter column lead_id type uuid using nullif(lead_id, '')::uuid,
    alter column type drop not null,
    add column sentiment text;
  alter table public.lead_responses
    add constraint lead_responses_lead_id_fkey foreign key (lead_id) references public.leads(id);

  -- leads and enriched_leads: the mission they came from.
  alter table public.leads
    add constraint leads_mission_id_fkey foreign key (mission_id) references public.antonia_missions(id) on delete set null;
  create index idx_leads_mission_id on public.leads using btree (mission_id);
  create index leads_mission_id_status_idx on public.leads using btree (mission_id, status);
  drop index public.leads_tenant_lookup_idx;

  alter table public.enriched_leads add column mission_id uuid;
  alter table public.enriched_leads
    add constraint enriched_leads_mission_id_fkey foreign key (mission_id) references public.antonia_missions(id) on delete set null;
  create index idx_enriched_leads_email on public.enriched_leads using btree (email);
  create index idx_enriched_leads_enrichment_status on public.enriched_leads using btree (enrichment_status);
  create index idx_enriched_leads_updated_at on public.enriched_leads using btree (updated_at);
  drop index public.enriched_leads_tenant_lookup_idx;

  -- Draft metadata: tied to the version and the research of the same person and organization, and read by its owner.
  alter table public.messaging_draft_generation_metadata
    drop constraint messaging_draft_generation_metadata_research_snapshot_id_fkey,
    drop constraint messaging_draft_generation_metadata_version_id_fkey;
  alter table public.messaging_draft_generation_metadata
    add constraint messaging_draft_generation_me_draft_id_version_id_organiza_fkey
      foreign key (draft_id, version_id, organization_id, user_id)
      references public.messaging_draft_versions(draft_id, id, organization_id, user_id) on delete cascade,
    add constraint messaging_draft_generation_me_research_snapshot_id_organiz_fkey
      foreign key (research_snapshot_id, organization_id, user_id)
      references public.research_snapshots(id, organization_id, user_id) on delete restrict;
  drop policy "Authenticated members can read draft generation metadata" on public.messaging_draft_generation_metadata;
  create policy "Authenticated members can read draft generation metadata"
    on public.messaging_draft_generation_metadata for select to authenticated
    using (public.research_messaging_row_access(organization_id, user_id));

  -- Draft claims: identified by the hash of the address, not by the address.
  alter table public.native_draft_generation_claims
    alter column claim_token drop default,
    alter column subject_email drop not null,
    drop constraint native_draft_generation_claims_email_check,
    drop constraint native_draft_generation_claims_research_snapshot_id_fkey;
  drop index public.native_draft_generation_claims_version_id_key;
  alter table public.native_draft_generation_claims
    add constraint native_draft_generation_claims_version_id_key unique (version_id),
    add constraint native_draft_generation_claims_identity_hash_check check (identity_hash ~ '^[a-f0-9]{64}$'::text),
    add constraint native_draft_generation_claim_research_snapshot_id_organiz_fkey
      foreign key (research_snapshot_id, organization_id, user_id)
      references public.research_snapshots(id, organization_id, user_id) on delete cascade;

  -- people_search_leads, profiles and unified_crm_data: column types and defaults.
  alter table public.people_search_leads
    alter column created_at drop not null,
    alter column departments type text[] using null::text[],
    alter column enrichment_status set default 'pending'::text,
    alter column updated_at set default timezone('utc'::text, now());
  create index idx_people_search_leads_enrichment_status on public.people_search_leads using btree (enrichment_status);

  alter table public.profiles alter column updated_at drop default;
  alter table public.profiles drop column created_at;

  alter table public.unified_crm_data alter column updated_at drop not null;
  alter table public.unified_crm_data add column created_at timestamp with time zone default now();
  create index idx_unified_crm_data_org on public.unified_crm_data using btree (organization_id);
  create index idx_unified_crm_data_stage on public.unified_crm_data using btree (stage);

  -- A table no code reads and production never had.
  drop table if exists public.outreach_template_cache;

  -- A send is only recorded for the current version of its draft.
  execute $function$
    create or replace function public.enforce_outbound_dispatch_current_version_v1()
     returns trigger
     language plpgsql
     security definer
     set search_path to 'public'
    as $body$
declare
  v_current_version_id uuid;
begin
  select md.current_version_id
  into v_current_version_id
  from public.messaging_drafts md
  where md.id = new.draft_id
    and md.organization_id = new.organization_id
    and md.user_id = new.user_id
  for share;

  if not found or v_current_version_id is distinct from new.version_id then
    raise exception 'outbound dispatch version is not the current draft version' using errcode = '23514';
  end if;
  return new;
end;
$body$
  $function$;
  create trigger outbound_dispatches_current_version_guard
    before insert on public.outbound_dispatches
    for each row execute function public.enforce_outbound_dispatch_current_version_v1();

  -- Approving twice returns the version the first approval left ready.
  execute $function$
    create or replace function public.approve_messaging_draft_v1(p_draft_id uuid, p_version_id uuid, p_organization_id uuid, p_user_id uuid, p_warnings jsonb default '[]'::jsonb)
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public'
    as $body$
declare
  v_parent public.messaging_draft_versions%rowtype;
  v_version_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_payload jsonb;
  v_preflight jsonb;
  v_approval jsonb;
begin
  if auth.uid() is distinct from p_user_id and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
  ) then
    raise exception 'draft organization membership is invalid' using errcode = '42501';
  end if;

  -- A retried approval returns the ready child that the first request already
  -- promoted, rather than treating the original draft as stale.
  select mdv.payload into v_payload
  from public.messaging_draft_versions mdv
  join public.messaging_drafts md on md.id = mdv.draft_id
  where mdv.draft_id = p_draft_id
    and mdv.parent_version_id = p_version_id
    and mdv.organization_id = p_organization_id
    and mdv.user_id = p_user_id
    and mdv.lifecycle = 'ready'
    and md.organization_id = p_organization_id
    and md.user_id = p_user_id
    and md.current_version_id = mdv.id
  order by mdv.revision desc
  limit 1;
  if found then
    return v_payload;
  end if;

  select mdv.* into v_parent
  from public.messaging_draft_versions mdv
  join public.messaging_drafts md on md.id = mdv.draft_id
  where mdv.draft_id = p_draft_id
    and mdv.id = p_version_id
    and mdv.organization_id = p_organization_id
    and mdv.user_id = p_user_id
    and md.organization_id = p_organization_id
    and md.user_id = p_user_id
    and md.current_version_id = mdv.id
  for update;
  if not found then
    -- A competing approval can commit while this call waits on the parent.
    select mdv.payload into v_payload
    from public.messaging_draft_versions mdv
    join public.messaging_drafts md on md.id = mdv.draft_id
    where mdv.draft_id = p_draft_id
      and mdv.parent_version_id = p_version_id
      and mdv.organization_id = p_organization_id
      and mdv.user_id = p_user_id
      and mdv.lifecycle = 'ready'
      and md.organization_id = p_organization_id
      and md.user_id = p_user_id
      and md.current_version_id = mdv.id
    order by mdv.revision desc
    limit 1;
    if found then
      return v_payload;
    end if;
    raise exception 'draft version is missing or is not current' using errcode = '40400';
  end if;
  if v_parent.lifecycle <> 'draft'
    or v_parent.approval ->> 'status' <> 'pending'
    or v_parent.preflight ->> 'status' <> 'pending' then
    raise exception 'only pending draft versions can be approved' using errcode = '22023';
  end if;

  v_approval := jsonb_build_object(
    'status', 'approved',
    'decidedBy', p_user_id,
    'decidedAt', v_now,
    'reason', null
  );
  v_preflight := jsonb_build_object(
    'status', 'passed',
    'checkedAt', v_now,
    'errors', '[]'::jsonb,
    'warnings', coalesce(case when jsonb_typeof(p_warnings) = 'array' then p_warnings else '[]'::jsonb end, '[]'::jsonb)
  );
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'draftId', p_draft_id,
    'versionId', v_version_id,
    'organizationId', v_parent.organization_id,
    'userId', v_parent.user_id,
    'researchSnapshotId', v_parent.research_snapshot_id,
    'revision', v_parent.revision + 1,
    'parentVersionId', v_parent.id,
    'lifecycle', 'ready',
    'channel', v_parent.channel,
    'recipient', v_parent.recipient,
    'content', v_parent.content,
    'approval', v_approval,
    'preflight', v_preflight,
    'createdAt', v_now
  );

  insert into public.messaging_draft_versions (
    id, draft_id, organization_id, user_id, research_snapshot_id, revision,
    parent_version_id, lifecycle, channel, recipient, content, approval,
    preflight, payload, content_hash, created_at
  ) values (
    v_version_id, p_draft_id, v_parent.organization_id, v_parent.user_id,
    v_parent.research_snapshot_id, v_parent.revision + 1, v_parent.id,
    'ready', v_parent.channel, v_parent.recipient, v_parent.content,
    v_approval, v_preflight, v_payload, v_parent.content_hash, v_now
  );

  update public.messaging_drafts
  set lifecycle = 'ready', current_revision = v_parent.revision + 1,
      current_version_id = v_version_id, updated_at = v_now
  where id = p_draft_id and current_version_id = p_version_id;

  return v_payload;
end;
$body$
  $function$;
end
$reconcile$;
