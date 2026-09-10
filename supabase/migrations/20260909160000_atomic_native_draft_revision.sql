-- Keep revision insertion, campaign review triggers and attribution in one transaction.
-- Existing tables, RLS policies and generic revision RPC are unchanged.
create or replace function public.append_native_messaging_draft_revision_v1(
  p_draft_id uuid,
  p_expected_parent_version_id uuid,
  p_payload jsonb,
  p_content_hash text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_parent public.messaging_draft_generation_metadata%rowtype;
  v_draft public.messaging_drafts%rowtype;
  v_result jsonb;
  v_method text := p_metadata ->> 'generationMethod';
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_draft_id::text, 0));
  select * into v_draft from public.messaging_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'messaging draft not found' using errcode = 'P0002';
  end if;
  if v_draft.lifecycle = 'archived' then
    raise exception 'NATIVE_DRAFT_ARCHIVED';
  end if;
  if v_draft.current_version_id is distinct from p_expected_parent_version_id then
    raise exception 'stale messaging draft parent revision' using errcode = '40001';
  end if;

  select * into v_parent from public.messaging_draft_generation_metadata
  where version_id = p_expected_parent_version_id
    and draft_id = p_draft_id
    and organization_id = v_draft.organization_id
    and user_id = v_draft.user_id
  for share;
  if not found then
    raise exception 'NATIVE_DRAFT_PROVENANCE_REQUIRED';
  end if;

  if p_metadata ->> 'versionId' is distinct from p_payload ->> 'versionId'
    or p_metadata ->> 'draftId' is distinct from p_draft_id::text
    or p_metadata ->> 'organizationId' is distinct from v_draft.organization_id::text
    or p_metadata ->> 'userId' is distinct from v_draft.user_id::text
    or p_payload ->> 'organizationId' is distinct from v_draft.organization_id::text
    or p_payload ->> 'userId' is distinct from v_draft.user_id::text
    or p_payload ->> 'researchSnapshotId' is distinct from v_parent.research_snapshot_id::text
    or p_metadata ->> 'researchSnapshotId' is distinct from v_parent.research_snapshot_id::text
    or p_metadata ->> 'reportDocumentId' is distinct from v_parent.report_document_id::text
    or p_metadata ->> 'reportSchemaVersion' is distinct from v_parent.report_schema_version
    or (p_metadata ->> 'reportRevision')::integer is distinct from v_parent.report_revision
    or p_metadata ->> 'reportContentHash' is distinct from v_parent.report_content_hash then
    raise exception 'NATIVE_DRAFT_METADATA_CONFLICT' using errcode = '22023';
  end if;

  if v_method is null or v_method not in ('human', 'model')
    or coalesce(pg_catalog.jsonb_typeof(p_metadata -> 'claimIds'), '') <> 'array'
    or nullif(p_metadata ->> 'promptVersion', '') is null then
    raise exception 'invalid native draft revision metadata' using errcode = '22023';
  end if;
  if v_method = 'human' and (
    p_metadata ->> 'provider' is not null
    or p_metadata ->> 'model' is not null
    or p_metadata ->> 'promptVersion' is distinct from 'native-draft/manual-revision/v1'
    or p_metadata ->> 'styleProfileId' is distinct from v_parent.style_profile_id::text
    or p_metadata -> 'claimIds' is distinct from v_parent.claim_ids
  ) then
    raise exception 'human revision must preserve source lineage' using errcode = '22023';
  end if;
  if v_method = 'model' and (
    p_metadata ->> 'provider' is distinct from 'openai'
    or nullif(p_metadata ->> 'model', '') is null
  ) then
    raise exception 'model revision requires generation attribution' using errcode = '22023';
  end if;

  v_result := public.append_messaging_draft_revision_v1(
    p_draft_id, p_expected_parent_version_id, p_payload, p_content_hash
  );

  -- The insert trigger clones source lineage. Missing metadata must roll back the append.
  update public.messaging_draft_generation_metadata
  set generation_method = v_method,
      provider = p_metadata ->> 'provider',
      model = p_metadata ->> 'model',
      prompt_version = p_metadata ->> 'promptVersion',
      style_profile_id = (p_metadata ->> 'styleProfileId')::uuid,
      claim_ids = p_metadata -> 'claimIds'
  where version_id = (p_payload ->> 'versionId')::uuid
    and draft_id = p_draft_id
    and organization_id = v_draft.organization_id
    and user_id = v_draft.user_id;
  if not found then
    raise exception 'NATIVE_DRAFT_METADATA_PERSIST_FAILED';
  end if;
  return v_result;
end;
$$;

revoke all on function public.append_native_messaging_draft_revision_v1(uuid, uuid, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_native_messaging_draft_revision_v1(uuid, uuid, jsonb, text, jsonb) to service_role;
