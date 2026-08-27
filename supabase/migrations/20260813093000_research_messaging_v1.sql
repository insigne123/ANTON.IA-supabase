-- Versioned research-to-messaging persistence and idempotent outbound dispatches.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    create extension pgcrypto;
  end if;
end $$;

create or replace function public.research_messaging_row_access(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = p_user_id
    and exists (
      select 1
      from public.organization_members om
      where om.organization_id = p_organization_id
        and om.user_id = auth.uid()
    );
$$;

revoke all on function public.research_messaging_row_access(uuid, uuid) from public;
grant execute on function public.research_messaging_row_access(uuid, uuid) to authenticated, service_role;

create or replace function public.research_messaging_jsonb_string_array_v1(
  p_value jsonb,
  p_min_length integer,
  p_max_length integer,
  p_max_items integer
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(p_value) <> 'array' then false
    else jsonb_array_length(p_value) <= p_max_items
      and not exists (
        select 1
        from jsonb_array_elements(p_value) as items(item)
        where jsonb_typeof(item) <> 'string'
          or length(trim(item #>> '{}')) not between p_min_length and p_max_length
      )
  end;
$$;

create or replace function public.research_messaging_is_iso_timestamptz_v1(
  p_value text
)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
begin
  if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return false;
  end if;
  perform p_value::timestamptz;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.research_messaging_iso_timestamptz_equals_v1(
  p_value text,
  p_expected timestamptz
)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
begin
  if not public.research_messaging_is_iso_timestamptz_v1(p_value) then
    return false;
  end if;
  return p_value::timestamptz = p_expected;
exception when others then
  return false;
end;
$$;

create table if not exists public.research_snapshots (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_ref text not null,
  source text not null,
  schema_version integer not null default 1,
  payload jsonb not null,
  content_hash text not null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint research_snapshots_lead_ref_check check (length(trim(lead_ref)) between 1 and 500),
  constraint research_snapshots_source_check check (length(trim(source)) between 1 and 100),
  constraint research_snapshots_schema_version_check check (schema_version = 1),
  constraint research_snapshots_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint research_snapshots_content_hash_check check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint research_snapshots_scope_check check (
    (organization_id is not null and scope_key = organization_id::text)
    or (organization_id is null and scope_key = concat('user:', user_id::text))
  ),
  unique (id, organization_id, user_id),
  unique (id, scope_key, user_id)
);

create table if not exists public.messaging_drafts (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  research_snapshot_id uuid,
  channel text not null,
  lifecycle text not null default 'draft',
  current_revision integer not null default 1,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messaging_drafts_channel_check check (channel in ('email', 'linkedin')),
  constraint messaging_drafts_lifecycle_check check (lifecycle in ('draft', 'ready', 'archived')),
  constraint messaging_drafts_current_revision_check check (current_revision >= 1),
  unique (id, organization_id, user_id),
  foreign key (research_snapshot_id, organization_id, user_id)
    references public.research_snapshots(id, organization_id, user_id) on delete restrict
);

create table if not exists public.messaging_draft_versions (
  id uuid primary key,
  draft_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  research_snapshot_id uuid,
  revision integer not null,
  parent_version_id uuid,
  lifecycle text not null,
  channel text not null,
  recipient jsonb not null,
  content jsonb not null,
  approval jsonb not null,
  preflight jsonb not null,
  payload jsonb not null,
  content_hash text not null,
  created_at timestamptz not null,
  persisted_at timestamptz not null default now(),
  constraint messaging_draft_versions_revision_check check (revision >= 1),
  constraint messaging_draft_versions_parent_check check (
    (revision = 1 and parent_version_id is null)
    or (revision > 1 and parent_version_id is not null)
  ),
  constraint messaging_draft_versions_lifecycle_check check (lifecycle in ('draft', 'ready', 'archived')),
  constraint messaging_draft_versions_channel_check check (channel in ('email', 'linkedin')),
  constraint messaging_draft_versions_json_check check (
    jsonb_typeof(recipient) = 'object'
    and jsonb_typeof(content) = 'object'
    and jsonb_typeof(approval) = 'object'
    and jsonb_typeof(preflight) = 'object'
    and jsonb_typeof(payload) = 'object'
  ),
  constraint messaging_draft_versions_content_hash_check check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint messaging_draft_versions_payload_check check (coalesce((
    payload ?& array[
      'schemaVersion', 'draftId', 'versionId', 'organizationId', 'userId',
      'researchSnapshotId', 'revision', 'parentVersionId', 'lifecycle',
      'channel', 'recipient', 'content', 'approval', 'preflight', 'createdAt'
    ]
    and payload - array[
      'schemaVersion', 'draftId', 'versionId', 'organizationId', 'userId',
      'researchSnapshotId', 'revision', 'parentVersionId', 'lifecycle',
      'channel', 'recipient', 'content', 'approval', 'preflight', 'createdAt'
    ] = '{}'::jsonb
    and payload -> 'schemaVersion' = to_jsonb(1)
    and payload ->> 'draftId' = draft_id::text
    and payload ->> 'versionId' = id::text
    and payload ->> 'organizationId' = organization_id::text
    and payload ->> 'userId' = user_id::text
    and jsonb_typeof(payload -> 'revision') = 'number'
    and (payload ->> 'revision')::integer = revision
    and payload ->> 'lifecycle' = lifecycle
    and payload ->> 'channel' = channel
    and payload -> 'recipient' = recipient
    and payload -> 'content' = content
    and payload -> 'approval' = approval
    and payload -> 'preflight' = preflight
    and (
      (research_snapshot_id is null and payload -> 'researchSnapshotId' = 'null'::jsonb)
      or payload ->> 'researchSnapshotId' = research_snapshot_id::text
    )
    and (
      (parent_version_id is null and payload -> 'parentVersionId' = 'null'::jsonb)
      or payload ->> 'parentVersionId' = parent_version_id::text
    )
    and jsonb_typeof(payload -> 'createdAt') = 'string'
    and public.research_messaging_iso_timestamptz_equals_v1(payload ->> 'createdAt', created_at)
  ), false)),
  constraint messaging_draft_versions_recipient_check check (coalesce((
    recipient ?& array['leadRef', 'displayName', 'email', 'linkedinUrl']
    and recipient - array['leadRef', 'displayName', 'email', 'linkedinUrl'] = '{}'::jsonb
    and (recipient -> 'leadRef' = 'null'::jsonb or (
      jsonb_typeof(recipient -> 'leadRef') = 'string'
      and length(trim(recipient ->> 'leadRef')) between 1 and 500
    ))
    and (recipient -> 'displayName' = 'null'::jsonb or (
      jsonb_typeof(recipient -> 'displayName') = 'string'
      and length(trim(recipient ->> 'displayName')) between 1 and 300
    ))
    and (recipient -> 'email' = 'null'::jsonb or (
      jsonb_typeof(recipient -> 'email') = 'string'
      and length(trim(recipient ->> 'email')) between 3 and 320
      and recipient ->> 'email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ))
    and (recipient -> 'linkedinUrl' = 'null'::jsonb or (
      jsonb_typeof(recipient -> 'linkedinUrl') = 'string'
      and length(trim(recipient ->> 'linkedinUrl')) between 1 and 2048
      and recipient ->> 'linkedinUrl' ~* '^https?://[^[:space:]]+$'
    ))
  ), false)),
  constraint messaging_draft_versions_content_shape_check check (coalesce((
    content ?& array['subject', 'text', 'html']
    and content - array['subject', 'text', 'html', 'deliveryOptions'] = '{}'::jsonb
    and (content -> 'subject' = 'null'::jsonb or (
      jsonb_typeof(content -> 'subject') = 'string'
      and length(trim(content ->> 'subject')) between 1 and 998
    ))
    and (content -> 'text' = 'null'::jsonb or (
      jsonb_typeof(content -> 'text') = 'string'
      and length(trim(content ->> 'text')) between 1 and 100000
    ))
    and (content -> 'html' = 'null'::jsonb or (
      jsonb_typeof(content -> 'html') = 'string'
      and length(trim(content ->> 'html')) between 1 and 500000
    ))
    and (
      not (content ? 'deliveryOptions')
      or (
        jsonb_typeof(content -> 'deliveryOptions') = 'object'
        and (content -> 'deliveryOptions') ? 'requestReceipts'
        and (content -> 'deliveryOptions') - 'requestReceipts' = '{}'::jsonb
        and jsonb_typeof(content #> '{deliveryOptions,requestReceipts}') = 'boolean'
      )
    )
  ), false)),
  constraint messaging_draft_versions_channel_content_check check (coalesce((
    (
      channel = 'email'
      and jsonb_typeof(recipient -> 'email') = 'string'
      and length(trim(recipient ->> 'email')) > 0
      and jsonb_typeof(content -> 'subject') = 'string'
      and length(trim(content ->> 'subject')) > 0
      and (
        (jsonb_typeof(content -> 'text') = 'string' and length(trim(content ->> 'text')) > 0)
        or (jsonb_typeof(content -> 'html') = 'string' and length(trim(content ->> 'html')) > 0)
      )
    )
    or (
      channel = 'linkedin'
      and jsonb_typeof(recipient -> 'linkedinUrl') = 'string'
      and length(trim(recipient ->> 'linkedinUrl')) > 0
      and jsonb_typeof(content -> 'text') = 'string'
      and length(trim(content ->> 'text')) > 0
      and content -> 'subject' = 'null'::jsonb
      and content -> 'html' = 'null'::jsonb
    )
  ), false)),
  constraint messaging_draft_versions_approval_check check (coalesce((
    approval ?& array['status', 'decidedBy', 'decidedAt', 'reason']
    and approval - array['status', 'decidedBy', 'decidedAt', 'reason'] = '{}'::jsonb
    and (
      (approval ->> 'status' = 'pending'
        and approval -> 'decidedBy' = 'null'::jsonb
        and approval -> 'decidedAt' = 'null'::jsonb
        and approval -> 'reason' = 'null'::jsonb)
      or (approval ->> 'status' = 'approved'
        and jsonb_typeof(approval -> 'decidedBy') = 'string'
        and approval ->> 'decidedBy' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and jsonb_typeof(approval -> 'decidedAt') = 'string'
        and public.research_messaging_is_iso_timestamptz_v1(approval ->> 'decidedAt')
        and approval -> 'reason' = 'null'::jsonb)
      or (approval ->> 'status' = 'rejected'
        and jsonb_typeof(approval -> 'decidedBy') = 'string'
        and approval ->> 'decidedBy' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and jsonb_typeof(approval -> 'decidedAt') = 'string'
        and public.research_messaging_is_iso_timestamptz_v1(approval ->> 'decidedAt')
        and jsonb_typeof(approval -> 'reason') = 'string'
        and length(trim(approval ->> 'reason')) between 1 and 2000)
    )
  ), false)),
  constraint messaging_draft_versions_preflight_check check (coalesce((
    preflight ?& array['status', 'checkedAt', 'errors', 'warnings']
    and preflight - array['status', 'checkedAt', 'errors', 'warnings'] = '{}'::jsonb
    and public.research_messaging_jsonb_string_array_v1(preflight -> 'errors', 1, 2000, 100)
    and public.research_messaging_jsonb_string_array_v1(preflight -> 'warnings', 1, 2000, 100)
    and (
      (preflight ->> 'status' = 'pending'
        and preflight -> 'checkedAt' = 'null'::jsonb
        and jsonb_array_length(preflight -> 'errors') = 0)
      or (preflight ->> 'status' = 'passed'
        and jsonb_typeof(preflight -> 'checkedAt') = 'string'
        and public.research_messaging_is_iso_timestamptz_v1(preflight ->> 'checkedAt')
        and jsonb_array_length(preflight -> 'errors') = 0)
      or (preflight ->> 'status' = 'failed'
        and jsonb_typeof(preflight -> 'checkedAt') = 'string'
        and public.research_messaging_is_iso_timestamptz_v1(preflight ->> 'checkedAt')
        and jsonb_array_length(preflight -> 'errors') > 0)
    )
  ), false)),
  constraint messaging_draft_versions_ready_check check (
    lifecycle <> 'ready'
    or (approval ->> 'status' = 'approved' and preflight ->> 'status' = 'passed')
  ),
  unique (draft_id, revision),
  unique (draft_id, id),
  unique (draft_id, id, organization_id, user_id),
  unique (parent_version_id),
  foreign key (draft_id, organization_id, user_id)
    references public.messaging_drafts(id, organization_id, user_id) on delete cascade,
  foreign key (research_snapshot_id, organization_id, user_id)
    references public.research_snapshots(id, organization_id, user_id) on delete restrict,
  foreign key (draft_id, parent_version_id)
    references public.messaging_draft_versions(draft_id, id) on delete cascade
);

alter table public.messaging_drafts
  add constraint messaging_drafts_current_version_fk
  foreign key (id, current_version_id)
  references public.messaging_draft_versions(draft_id, id)
  deferrable initially deferred;

create table if not exists public.outbound_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_id uuid not null,
  version_id uuid not null,
  idempotency_key text not null,
  content_hash text not null,
  channel text not null,
  provider text not null,
  status text not null default 'pending',
  metadata jsonb not null,
  provider_message_id text,
  provider_response jsonb,
  error_code text,
  error_message text,
  attempt_count integer not null default 0,
  reconciliation_attempt_count integer not null default 0,
  last_reconciliation_at timestamptz,
  reconciliation_claimed_at timestamptz,
  reconciled_at timestamptz,
  reconciliation_details jsonb,
  history_repair_status text not null default 'pending',
  history_repair_attempt_count integer not null default 0,
  last_history_repair_at timestamptz,
  history_repair_error text,
  requested_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_dispatches_idempotency_key_check check (length(trim(idempotency_key)) between 1 and 200),
  constraint outbound_dispatches_content_hash_check check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint outbound_dispatches_channel_check check (channel in ('email', 'linkedin')),
  constraint outbound_dispatches_provider_check check (length(trim(provider)) between 1 and 100),
  constraint outbound_dispatches_status_check check (status in ('pending', 'sending', 'sent', 'failed', 'deferred', 'unknown')),
  constraint outbound_dispatches_metadata_check check (coalesce((
    jsonb_typeof(metadata) = 'object'
    and metadata ?& array[
      'schemaVersion', 'organizationId', 'userId', 'draftId', 'versionId',
      'revision', 'channel', 'recipient', 'contentHash', 'idempotencyKey',
      'provider', 'requestedAt'
    ]
    and metadata - array[
      'schemaVersion', 'organizationId', 'userId', 'draftId', 'versionId',
      'revision', 'channel', 'recipient', 'contentHash', 'idempotencyKey',
      'provider', 'requestedAt'
    ] = '{}'::jsonb
    and metadata -> 'schemaVersion' = to_jsonb(1)
    and metadata ->> 'organizationId' = organization_id::text
    and metadata ->> 'userId' = user_id::text
    and metadata ->> 'draftId' = draft_id::text
    and metadata ->> 'versionId' = version_id::text
    and jsonb_typeof(metadata -> 'revision') = 'number'
    and (metadata ->> 'revision')::integer >= 1
    and metadata ->> 'contentHash' = content_hash
    and metadata ->> 'idempotencyKey' = idempotency_key
    and metadata ->> 'channel' = channel
    and metadata ->> 'provider' = provider
    and jsonb_typeof(metadata -> 'recipient') = 'object'
    and (metadata -> 'recipient') ?& array['leadRef', 'displayName', 'email', 'linkedinUrl']
    and (metadata -> 'recipient') - array['leadRef', 'displayName', 'email', 'linkedinUrl'] = '{}'::jsonb
    and ((metadata #> '{recipient,leadRef}') = 'null'::jsonb or (
      jsonb_typeof(metadata #> '{recipient,leadRef}') = 'string'
      and length(trim(metadata #>> '{recipient,leadRef}')) between 1 and 500
    ))
    and ((metadata #> '{recipient,displayName}') = 'null'::jsonb or (
      jsonb_typeof(metadata #> '{recipient,displayName}') = 'string'
      and length(trim(metadata #>> '{recipient,displayName}')) between 1 and 300
    ))
    and ((metadata #> '{recipient,email}') = 'null'::jsonb or (
      jsonb_typeof(metadata #> '{recipient,email}') = 'string'
      and length(trim(metadata #>> '{recipient,email}')) between 3 and 320
      and metadata #>> '{recipient,email}' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ))
    and ((metadata #> '{recipient,linkedinUrl}') = 'null'::jsonb or (
      jsonb_typeof(metadata #> '{recipient,linkedinUrl}') = 'string'
      and length(trim(metadata #>> '{recipient,linkedinUrl}')) between 1 and 2048
      and metadata #>> '{recipient,linkedinUrl}' ~* '^https?://[^[:space:]]+$'
    ))
    and jsonb_typeof(metadata -> 'requestedAt') = 'string'
    and public.research_messaging_iso_timestamptz_equals_v1(metadata ->> 'requestedAt', requested_at)
  ), false)),
  constraint outbound_dispatches_attempt_count_check check (attempt_count >= 0),
  constraint outbound_dispatches_reconciliation_attempt_count_check check (reconciliation_attempt_count >= 0),
  constraint outbound_dispatches_history_repair_status_check check (history_repair_status in ('pending', 'complete', 'failed')),
  constraint outbound_dispatches_history_repair_attempt_count_check check (history_repair_attempt_count >= 0),
  constraint outbound_dispatches_state_check check (
    (status = 'pending' and started_at is null and completed_at is null and attempt_count = 0)
    or (status = 'sending' and started_at is not null and completed_at is null and attempt_count >= 1)
    or (status = 'sent' and started_at is not null and completed_at is not null and attempt_count >= 1 and provider_message_id is not null)
    or (status = 'failed' and started_at is not null and completed_at is not null and attempt_count >= 1 and error_message is not null)
    or (status = 'deferred' and started_at is not null and completed_at is not null and attempt_count >= 1 and provider_message_id is null and error_message is not null)
    or (status = 'unknown' and completed_at is not null and error_message is not null)
  ),
  unique (organization_id, idempotency_key),
  foreign key (draft_id, version_id, organization_id, user_id)
    references public.messaging_draft_versions(draft_id, id, organization_id, user_id) on delete cascade
);

alter table public.outbound_dispatches
  add column if not exists reconciliation_claimed_at timestamptz,
  add column if not exists history_repair_status text not null default 'pending',
  add column if not exists history_repair_attempt_count integer not null default 0,
  add column if not exists last_history_repair_at timestamptz,
  add column if not exists history_repair_error text;

alter table public.contacted_leads
  add column if not exists thread_id text,
  add column if not exists conversation_id text,
  add column if not exists internet_message_id text,
  add column if not exists last_follow_up_at timestamptz,
  add column if not exists last_step_idx integer default -1,
  add column if not exists follow_up_count integer default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outbound_dispatches_history_repair_status_check') then
    alter table public.outbound_dispatches
      add constraint outbound_dispatches_history_repair_status_check
      check (history_repair_status in ('pending', 'complete', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'outbound_dispatches_history_repair_attempt_count_check') then
    alter table public.outbound_dispatches
      add constraint outbound_dispatches_history_repair_attempt_count_check
      check (history_repair_attempt_count >= 0);
  end if;
end $$;

create table if not exists public.outbound_quota_reservations (
  dispatch_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_scope text not null,
  quota_day date not null,
  reservation_status text not null default 'reserved',
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint outbound_quota_reservations_scope_check check (quota_scope in ('user', 'organization')),
  constraint outbound_quota_reservations_status_check check (
    (reservation_status = 'reserved' and settled_at is null)
    or (reservation_status = 'settled' and settled_at is not null)
  )
);

create table if not exists public.outbound_contact_quota_buckets (
  scope_key text not null,
  quota_day date not null,
  baseline_count integer not null,
  reservation_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope_key, quota_day),
  constraint outbound_contact_quota_buckets_counts_check check (baseline_count >= 0 and reservation_count >= 0)
);

alter table public.outbound_quota_reservations
  add constraint outbound_quota_reservations_dispatch_fk
  foreign key (dispatch_id) references public.outbound_dispatches(id) on delete cascade;

create table if not exists public.lead_research_jobs (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_report_id text not null,
  lead_ref text not null,
  lead_id text,
  email text,
  company_name text,
  company_domain text,
  provider text not null,
  status text not null default 'queued',
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  research_snapshot_id uuid,
  error_code text,
  error_message text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_research_jobs_lead_ref_check check (length(trim(lead_ref)) between 1 and 500),
  constraint lead_research_jobs_provider_report_id_check check (length(trim(provider_report_id)) between 1 and 200),
  constraint lead_research_jobs_provider_check check (length(trim(provider)) between 1 and 100),
  constraint lead_research_jobs_status_check check (status in ('queued', 'running', 'completed', 'partial', 'insufficient_data', 'failed', 'cancelled')),
  constraint lead_research_jobs_request_payload_check check (jsonb_typeof(request_payload) = 'object'),
  constraint lead_research_jobs_result_payload_check check (result_payload is null or jsonb_typeof(result_payload) = 'object'),
  constraint lead_research_jobs_scope_check check (
    (organization_id is not null and scope_key = organization_id::text)
    or (organization_id is null and scope_key = concat('user:', user_id::text))
  ),
  constraint lead_research_jobs_attempts_check check (
    attempt_count >= 0 and max_attempts >= 1 and attempt_count <= max_attempts
  ),
  constraint lead_research_jobs_state_check check (
    (status = 'queued' and started_at is null and completed_at is null)
    or (status = 'running' and started_at is not null and completed_at is null)
    or (status in ('completed', 'partial') and started_at is not null and completed_at is not null and research_snapshot_id is not null)
    or (status = 'insufficient_data' and started_at is not null and completed_at is not null)
    or (status = 'failed' and started_at is not null and completed_at is not null and error_message is not null)
    or (status = 'cancelled' and completed_at is not null)
  ),
  foreign key (research_snapshot_id, organization_id, user_id)
    references public.research_snapshots(id, organization_id, user_id) on delete restrict,
  foreign key (research_snapshot_id, scope_key, user_id)
    references public.research_snapshots(id, scope_key, user_id) on delete restrict,
  unique (provider, provider_report_id)
);

create index if not exists research_snapshots_scope_lead_idx
  on public.research_snapshots(organization_id, user_id, lead_ref, captured_at desc);
create index if not exists research_snapshots_hash_idx
  on public.research_snapshots(organization_id, content_hash);
create index if not exists messaging_drafts_scope_updated_idx
  on public.messaging_drafts(organization_id, user_id, updated_at desc);
create index if not exists messaging_drafts_retention_idx
  on public.messaging_drafts(updated_at);
create index if not exists messaging_drafts_snapshot_idx
  on public.messaging_drafts(research_snapshot_id)
  where research_snapshot_id is not null;
create index if not exists messaging_draft_versions_draft_revision_idx
  on public.messaging_draft_versions(draft_id, revision desc);
create index if not exists messaging_draft_versions_scope_created_idx
  on public.messaging_draft_versions(organization_id, user_id, created_at desc);
create index if not exists messaging_draft_versions_snapshot_idx
  on public.messaging_draft_versions(research_snapshot_id)
  where research_snapshot_id is not null;
create index if not exists messaging_draft_versions_recipient_email_idx
  on public.messaging_draft_versions((lower(trim(recipient ->> 'email'))))
  where recipient ->> 'email' is not null;
create index if not exists outbound_dispatches_scope_status_idx
  on public.outbound_dispatches(organization_id, user_id, status, created_at desc);
create index if not exists outbound_dispatches_version_idx
  on public.outbound_dispatches(version_id, created_at desc);
create index if not exists outbound_dispatches_recipient_email_idx
  on public.outbound_dispatches((lower(trim(metadata #>> '{recipient,email}'))))
  where metadata #>> '{recipient,email}' is not null;
create index if not exists outbound_dispatches_reconciliation_idx
  on public.outbound_dispatches(updated_at, reconciliation_attempt_count)
  where status in ('sending', 'unknown');
create index if not exists outbound_dispatches_history_repair_idx
  on public.outbound_dispatches(reconciled_at, history_repair_attempt_count)
  where status = 'sent' and reconciled_at is not null and history_repair_status in ('pending', 'failed');
create index if not exists outbound_dispatches_retention_idx
  on public.outbound_dispatches(completed_at)
  where status in ('sent', 'failed', 'unknown');
create index if not exists outbound_quota_reservations_scope_day_idx
  on public.outbound_quota_reservations(quota_scope, organization_id, user_id, quota_day);
create index if not exists lead_research_jobs_queue_idx
  on public.lead_research_jobs(status, scheduled_for, created_at)
  where status in ('queued', 'running');
create index if not exists lead_research_jobs_scope_lead_idx
  on public.lead_research_jobs(scope_key, user_id, lead_ref, created_at desc);
create index if not exists lead_research_jobs_email_idx
  on public.lead_research_jobs(scope_key, (lower(trim(email))))
  where email is not null;
create index if not exists lead_research_jobs_email_only_idx
  on public.lead_research_jobs((lower(trim(email))))
  where email is not null;
create index if not exists lead_research_jobs_snapshot_idx
  on public.lead_research_jobs(research_snapshot_id)
  where research_snapshot_id is not null;
create index if not exists lead_research_jobs_retention_idx
  on public.lead_research_jobs(completed_at)
  where status in ('completed', 'partial', 'insufficient_data', 'failed', 'cancelled');
create index if not exists research_snapshots_subject_email_idx
  on public.research_snapshots((lower(trim(payload #>> '{subject,email}'))))
  where payload #>> '{subject,email}' is not null;
create index if not exists research_snapshots_retention_idx
  on public.research_snapshots(captured_at);
create index if not exists profiles_privacy_email_idx
  on public.profiles((lower(trim(email))));
create index if not exists leads_privacy_email_idx
  on public.leads((lower(trim(email))));
create index if not exists enriched_leads_privacy_email_idx
  on public.enriched_leads((lower(trim(email))));
create index if not exists contacted_leads_privacy_email_idx
  on public.contacted_leads((lower(trim(email))));
create index if not exists unsubscribed_emails_privacy_email_idx
  on public.unsubscribed_emails((lower(trim(email))));
create index if not exists lead_research_reports_privacy_email_idx
  on public.lead_research_reports((lower(trim(email))));
create index if not exists privacy_requests_closed_updated_idx
  on public.privacy_requests(updated_at)
  where status in ('resolved', 'rejected');

create or replace function public.reject_immutable_research_messaging_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and (
    coalesce(current_setting('app.privacy_delete', true), '') = 'on'
    or coalesce(auth.role(), '') = 'service_role'
  ) then
    return old;
  end if;
  raise exception '% rows are immutable', tg_table_name using errcode = '55000';
end;
$$;

create trigger research_snapshots_immutable
  before update or delete on public.research_snapshots
  for each row execute function public.reject_immutable_research_messaging_row();

create trigger messaging_draft_versions_immutable
  before update or delete on public.messaging_draft_versions
  for each row execute function public.reject_immutable_research_messaging_row();

create or replace function public.enforce_outbound_dispatch_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.privacy_delete', true), '') = 'on'
      or coalesce(auth.role(), '') = 'service_role' then
      return old;
    end if;
    raise exception 'outbound dispatches cannot be deleted' using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'outbound dispatches must be created pending' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.messaging_draft_versions mdv
      where mdv.draft_id = new.draft_id
        and mdv.id = new.version_id
        and mdv.organization_id = new.organization_id
        and mdv.user_id = new.user_id
        and mdv.revision = (new.metadata ->> 'revision')::integer
        and mdv.channel = new.channel
        and mdv.recipient = new.metadata -> 'recipient'
        and mdv.content_hash = new.content_hash
    ) then
      raise exception 'outbound dispatch metadata does not match draft version' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id
    or new.draft_id is distinct from old.draft_id
    or new.version_id is distinct from old.version_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.content_hash is distinct from old.content_hash
    or new.channel is distinct from old.channel
    or new.provider is distinct from old.provider
    or new.metadata is distinct from old.metadata
    or new.requested_at is distinct from old.requested_at
    or new.created_at is distinct from old.created_at then
    raise exception 'outbound dispatch identity is immutable' using errcode = '55000';
  end if;

  if new.reconciliation_attempt_count < old.reconciliation_attempt_count
    or new.attempt_count < old.attempt_count then
    raise exception 'outbound dispatch counters cannot decrease' using errcode = '55000';
  end if;

  if old.status = 'pending'
    and new.status = 'sending'
    and new.attempt_count = old.attempt_count + 1 then
    return new;
  end if;
  if old.status = 'pending'
    and new.status = 'unknown'
    and new.attempt_count = old.attempt_count then
    return new;
  end if;
  if old.status = 'sending'
    and new.status = 'unknown'
    and new.reconciliation_attempt_count = old.reconciliation_attempt_count
    and new.reconciliation_claimed_at is not null
    and new.last_reconciliation_at is not distinct from old.last_reconciliation_at
    and new.reconciled_at is not distinct from old.reconciled_at
    and new.reconciliation_details is not distinct from old.reconciliation_details then
    return new;
  end if;
  if old.status = 'sending'
    and new.status in ('sent', 'failed', 'deferred', 'unknown')
    and new.attempt_count = old.attempt_count then
    return new;
  end if;
  if old.status = 'deferred'
    and new.status = 'sending'
    and new.attempt_count = old.attempt_count + 1
    and new.provider_message_id is null
    and new.provider_response is null
    and new.error_code is null
    and new.error_message is null then
    return new;
  end if;
  if old.status = 'deferred'
    and new.status = 'unknown'
    and new.attempt_count = old.attempt_count then
    return new;
  end if;
  if old.status = 'unknown'
    and new.status = 'unknown'
    and new.reconciliation_attempt_count = old.reconciliation_attempt_count
    and new.reconciliation_claimed_at is not null
    and new.reconciliation_claimed_at is distinct from old.reconciliation_claimed_at
    and new.last_reconciliation_at is not distinct from old.last_reconciliation_at
    and new.reconciled_at is not distinct from old.reconciled_at
    and new.reconciliation_details is not distinct from old.reconciliation_details then
    return new;
  end if;
  if old.status = 'unknown'
    and new.status = 'unknown'
    and new.reconciliation_attempt_count = old.reconciliation_attempt_count
    and old.reconciliation_claimed_at is not null
    and new.reconciliation_claimed_at is null
    and new.last_reconciliation_at is not distinct from old.last_reconciliation_at
    and new.reconciled_at is not distinct from old.reconciled_at
    and new.reconciliation_details is not distinct from old.reconciliation_details then
    return new;
  end if;
  if old.status = 'unknown'
    and new.status in ('unknown', 'sent', 'failed')
    and new.reconciliation_attempt_count = old.reconciliation_attempt_count + 1
    and new.last_reconciliation_at is not null
    and (new.status = 'unknown' or new.reconciled_at is not null) then
    return new;
  end if;
  if old.status = 'sent'
    and new.status = 'sent'
    and old.reconciled_at is not null
    and old.history_repair_status in ('pending', 'failed')
    and new.history_repair_status in ('complete', 'failed')
    and new.history_repair_attempt_count = old.history_repair_attempt_count + 1
    and new.last_history_repair_at is not null
    and (
      (new.history_repair_status = 'complete' and new.history_repair_error is null)
      or (new.history_repair_status = 'failed' and length(trim(coalesce(new.history_repair_error, ''))) > 0)
    )
    and to_jsonb(new) - array[
      'history_repair_status', 'history_repair_attempt_count',
      'last_history_repair_at', 'history_repair_error'
    ] = to_jsonb(old) - array[
      'history_repair_status', 'history_repair_attempt_count',
      'last_history_repair_at', 'history_repair_error'
    ] then
    return new;
  end if;

  raise exception 'invalid outbound dispatch transition: % -> %', old.status, new.status
    using errcode = '55000';
end;
$$;

drop trigger if exists outbound_dispatches_transition_guard on public.outbound_dispatches;
create trigger outbound_dispatches_transition_guard
  before insert or update or delete on public.outbound_dispatches
  for each row execute function public.enforce_outbound_dispatch_transition();

create or replace function public.decrement_outbound_contact_quota_reservation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope_key text := concat(
    old.quota_scope,
    ':',
    case when old.quota_scope = 'user' then old.user_id::text else old.organization_id::text end
  );
begin
  update public.outbound_contact_quota_buckets
  set baseline_count = case
        when old.reservation_status = 'settled' then baseline_count - 1
        else baseline_count
      end,
      reservation_count = case
        when old.reservation_status = 'reserved' then reservation_count - 1
        else reservation_count
      end,
      updated_at = now()
  where scope_key = v_scope_key
    and quota_day = old.quota_day
    and (
      (old.reservation_status = 'reserved' and reservation_count > 0)
      or (old.reservation_status = 'settled' and baseline_count > 0)
    );

  if not found then
    raise exception 'quota reservation bucket is missing or empty for dispatch %', old.dispatch_id
      using errcode = '55000';
  end if;
  return old;
end;
$$;

create trigger outbound_quota_reservations_decrement
  after delete on public.outbound_quota_reservations
  for each row execute function public.decrement_outbound_contact_quota_reservation_v1();

create or replace function public.settle_sent_outbound_contact_quota_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope_key text;
  v_quota_day date;
begin
  if old.status <> 'sent' and new.status = 'sent' then
    perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));

    select
      concat(
        oqr.quota_scope,
        ':',
        case when oqr.quota_scope = 'user' then oqr.user_id::text else oqr.organization_id::text end
      ),
      oqr.quota_day
    into v_scope_key, v_quota_day
    from public.outbound_quota_reservations oqr
    where oqr.dispatch_id = new.id
      and oqr.reservation_status = 'reserved';

    if found then
      update public.outbound_contact_quota_buckets
      set baseline_count = baseline_count + 1,
          reservation_count = reservation_count - 1,
          updated_at = now()
      where scope_key = v_scope_key
        and quota_day = v_quota_day
        and reservation_count > 0;
      if not found then
        raise exception 'quota reservation bucket is missing or empty for dispatch %', new.id
          using errcode = '55000';
      end if;

      update public.outbound_quota_reservations
      set reservation_status = 'settled',
          settled_at = coalesce(new.completed_at, now())
      where dispatch_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger outbound_dispatches_settle_sent_quota
  after update of status on public.outbound_dispatches
  for each row execute function public.settle_sent_outbound_contact_quota_v1();

create or replace function public.release_failed_outbound_contact_quota_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status and new.status in ('failed', 'deferred') then
    perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
    delete from public.outbound_quota_reservations
    where dispatch_id = new.id;
  end if;
  return new;
end;
$$;

create trigger outbound_dispatches_release_failed_quota
  after update of status on public.outbound_dispatches
  for each row execute function public.release_failed_outbound_contact_quota_v1();

create or replace function public.reserve_outbound_contact_quota_v1(
  p_dispatch_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_scope text,
  p_limit integer,
  p_base_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := timezone('utc', now())::date;
  v_reservations integer := 0;
  v_input_base integer := greatest(coalesce(p_base_count, 0), 0);
  v_used integer := 0;
  v_scope_key text := concat(p_scope, ':', case when p_scope = 'user' then p_user_id::text else p_organization_id::text end);
  v_dispatch_organization_id uuid;
  v_dispatch_user_id uuid;
  v_dispatch_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_scope is null
    or p_scope not in ('user', 'organization')
    or p_limit is null
    or p_limit < 0
    or p_organization_id is null
    or p_user_id is null then
    raise exception 'invalid quota reservation input' using errcode = '22023';
  end if;

  select od.organization_id, od.user_id, od.status
  into v_dispatch_organization_id, v_dispatch_user_id, v_dispatch_status
  from public.outbound_dispatches od
  where od.id = p_dispatch_id
    and od.status in ('sending', 'failed')
  for update;
  if not found then
    raise exception 'quota dispatch is missing or has an invalid status' using errcode = '55000';
  end if;
  if v_dispatch_organization_id <> p_organization_id or v_dispatch_user_id <> p_user_id then
    raise exception 'quota reservation scope does not match dispatch' using errcode = '22023';
  end if;
  if v_dispatch_status = 'failed' then
    raise exception 'failed dispatch has no existing quota reservation' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_dispatch_id::text,
    0
  ));

  insert into public.outbound_contact_quota_buckets (
    scope_key, quota_day, baseline_count, reservation_count
  ) values (
    v_scope_key, v_day, v_input_base, 0
  ) on conflict (scope_key, quota_day) do nothing;

  select reservation_count, baseline_count
  into v_reservations, v_used
  from public.outbound_contact_quota_buckets
  where scope_key = v_scope_key and quota_day = v_day
  for update;

  if exists (
    select 1
    from public.outbound_quota_reservations oqr
    where oqr.dispatch_id = p_dispatch_id
      and oqr.organization_id = p_organization_id
      and oqr.user_id = p_user_id
      and oqr.quota_scope = p_scope
      and oqr.quota_day = v_day
  ) then
    return jsonb_build_object('allowed', true, 'count', v_used + v_reservations, 'limit', p_limit, 'reserved', false);
  end if;
  if exists (
    select 1
    from public.outbound_quota_reservations oqr
    where oqr.dispatch_id = p_dispatch_id
  ) then
    raise exception 'existing quota reservation does not match dispatch scope or day' using errcode = '22023';
  end if;

  if v_used + v_reservations >= p_limit then
    return jsonb_build_object('allowed', false, 'count', v_used + v_reservations, 'limit', p_limit, 'reserved', false);
  end if;

  insert into public.outbound_quota_reservations (
    dispatch_id, organization_id, user_id, quota_scope, quota_day
  ) values (
    p_dispatch_id, p_organization_id, p_user_id, p_scope, v_day
  );
  update public.outbound_contact_quota_buckets
  set reservation_count = reservation_count + 1, updated_at = now()
  where scope_key = v_scope_key and quota_day = v_day;
  return jsonb_build_object('allowed', true, 'count', v_used + v_reservations + 1, 'limit', p_limit, 'reserved', true);
end;
$$;

revoke all on function public.reserve_outbound_contact_quota_v1(uuid, uuid, uuid, text, integer, integer) from public;
grant execute on function public.reserve_outbound_contact_quota_v1(uuid, uuid, uuid, text, integer, integer) to service_role;

create or replace function public.release_outbound_contact_quota_v1(
  p_dispatch_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform 1
  from public.outbound_dispatches od
  where od.id = p_dispatch_id
    and od.status in ('failed', 'deferred')
  for share;
  if not found then
    raise exception 'quota reservation can only be released for failed or deferred dispatches' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_dispatch_id::text, 0));

  perform 1
  from public.outbound_quota_reservations
  where dispatch_id = p_dispatch_id
  for update;
  if not found then return false; end if;

  delete from public.outbound_quota_reservations where dispatch_id = p_dispatch_id;
  return true;
end;
$$;

revoke all on function public.release_outbound_contact_quota_v1(uuid) from public;
grant execute on function public.release_outbound_contact_quota_v1(uuid) to service_role;

create or replace function public.lookup_research_messaging_subject_v1(
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_linked_snapshot_ids uuid[] := '{}'::uuid[];
  v_snapshot_ids uuid[] := '{}'::uuid[];
  v_draft_ids uuid[] := '{}'::uuid[];
  v_legacy_linked_snapshots integer := 0;
  v_mismatched_linked_snapshots integer := 0;
  v_omitted_jobs integer := 0;
  v_omitted_drafts integer := 0;
  v_omitted_versions integer := 0;
  v_omitted_dispatches integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct candidate.draft_id), '{}'::uuid[])
  into v_draft_ids
  from (
    select mdv.draft_id
    from public.messaging_draft_versions mdv
    where lower(trim(coalesce(mdv.recipient ->> 'email', ''))) = v_email
    union
    select od.draft_id
    from public.outbound_dispatches od
    where lower(trim(coalesce(od.metadata #>> '{recipient,email}', ''))) = v_email
  ) candidate;

  select coalesce(
    array_agg(distinct candidate.snapshot_id) filter (where candidate.snapshot_id is not null),
    '{}'::uuid[]
  )
  into v_linked_snapshot_ids
  from (
    select lrj.research_snapshot_id as snapshot_id
    from public.lead_research_jobs lrj
    where lower(trim(coalesce(lrj.email, ''))) = v_email
    union
    select md.research_snapshot_id
    from public.messaging_drafts md
    where md.id = any(v_draft_ids)
    union
    select mdv.research_snapshot_id
    from public.messaging_draft_versions mdv
    where mdv.draft_id = any(v_draft_ids)
  ) candidate;

  select
    count(*) filter (
      where nullif(trim(coalesce(rs.payload #>> '{subject,email}', '')), '') is null
    ),
    count(*) filter (
      where nullif(trim(coalesce(rs.payload #>> '{subject,email}', '')), '') is not null
        and lower(trim(rs.payload #>> '{subject,email}')) <> v_email
    )
  into v_legacy_linked_snapshots, v_mismatched_linked_snapshots
  from public.research_snapshots rs
  where rs.id = any(v_linked_snapshot_ids);

  select coalesce(array_agg(rs.id), '{}'::uuid[])
  into v_snapshot_ids
  from public.research_snapshots rs
  where lower(trim(coalesce(rs.payload #>> '{subject,email}', ''))) = v_email;

  select count(*) into v_omitted_jobs
  from public.lead_research_jobs lrj
  where lrj.research_snapshot_id = any(v_snapshot_ids)
    and lower(trim(coalesce(lrj.email, ''))) <> v_email;

  select count(*) into v_omitted_drafts
  from public.messaging_drafts md
  where md.research_snapshot_id = any(v_snapshot_ids)
    and not (md.id = any(v_draft_ids));

  select count(*) into v_omitted_versions
  from public.messaging_draft_versions mdv
  where (
      mdv.research_snapshot_id = any(v_snapshot_ids)
      or mdv.draft_id = any(v_draft_ids)
      or exists (
        select 1
        from public.messaging_drafts md
        where md.id = mdv.draft_id
          and md.research_snapshot_id = any(v_snapshot_ids)
      )
    )
    and lower(trim(coalesce(mdv.recipient ->> 'email', ''))) <> v_email;

  select count(*) into v_omitted_dispatches
  from public.outbound_dispatches od
  where (
      od.draft_id = any(v_draft_ids)
      or exists (
        select 1
        from public.messaging_drafts md
        where md.id = od.draft_id
          and md.research_snapshot_id = any(v_snapshot_ids)
      )
      or exists (
        select 1
        from public.messaging_draft_versions mdv
        where mdv.draft_id = od.draft_id
          and mdv.research_snapshot_id = any(v_snapshot_ids)
      )
    )
    and lower(trim(coalesce(od.metadata #>> '{recipient,email}', ''))) <> v_email;

  return jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.updated_at desc nulls last)
      from public.profiles p
      where lower(trim(coalesce(p.email, ''))) = v_email
    ), '[]'::jsonb),
    'leads', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at desc nulls last)
      from public.leads l
      where lower(trim(coalesce(l.email, ''))) = v_email
    ), '[]'::jsonb),
    'enrichedLeads', coalesce((
      select jsonb_agg(to_jsonb(el) order by el.updated_at desc nulls last)
      from public.enriched_leads el
      where lower(trim(coalesce(el.email, ''))) = v_email
    ), '[]'::jsonb),
    'contactedLeads', coalesce((
      select jsonb_agg(to_jsonb(cl) order by cl.sent_at desc nulls last)
      from public.contacted_leads cl
      where lower(trim(coalesce(cl.email, ''))) = v_email
    ), '[]'::jsonb),
    'unsubscribedEntries', coalesce((
      select jsonb_agg(to_jsonb(ue) order by ue.created_at desc nulls last)
      from public.unsubscribed_emails ue
      where lower(trim(coalesce(ue.email, ''))) = v_email
    ), '[]'::jsonb),
    'researchReports', coalesce((
      select jsonb_agg(to_jsonb(lrr) order by lrr.updated_at desc nulls last)
      from public.lead_research_reports lrr
      where lower(trim(coalesce(lrr.email, ''))) = v_email
    ), '[]'::jsonb),
    'researchSnapshots', coalesce((
      select jsonb_agg(to_jsonb(rs) order by rs.captured_at desc)
      from public.research_snapshots rs
      where rs.id = any(v_snapshot_ids)
    ), '[]'::jsonb),
    'researchJobs', coalesce((
      select jsonb_agg(to_jsonb(lrj) order by lrj.created_at desc)
      from public.lead_research_jobs lrj
      where lower(trim(coalesce(lrj.email, ''))) = v_email
    ), '[]'::jsonb),
    'messagingDrafts', coalesce((
      select jsonb_agg(to_jsonb(md) order by md.updated_at desc)
      from public.messaging_drafts md
      where md.id = any(v_draft_ids)
    ), '[]'::jsonb),
    'messagingDraftVersions', coalesce((
      select jsonb_agg(to_jsonb(mdv) order by mdv.created_at desc)
      from public.messaging_draft_versions mdv
      where mdv.draft_id = any(v_draft_ids)
        and lower(trim(coalesce(mdv.recipient ->> 'email', ''))) = v_email
    ), '[]'::jsonb),
    'outboundDispatches', coalesce((
      select jsonb_agg(to_jsonb(od) order by od.requested_at desc)
      from public.outbound_dispatches od
      where lower(trim(coalesce(od.metadata #>> '{recipient,email}', ''))) = v_email
    ), '[]'::jsonb),
    'emailEvents', coalesce((
      select jsonb_agg(to_jsonb(ee) order by ee.event_at desc)
      from public.email_events ee
      where exists (
        select 1
        from public.contacted_leads cl
        where cl.id = ee.contacted_id
          and lower(trim(coalesce(cl.email, ''))) = v_email
      )
    ), '[]'::jsonb),
    'leadResponses', coalesce((
      select jsonb_agg(to_jsonb(lr) order by lr.created_at desc)
      from public.lead_responses lr
      where exists (
        select 1
        from public.contacted_leads cl
        where cl.id = lr.contacted_id
          and lower(trim(coalesce(cl.email, ''))) = v_email
      )
    ), '[]'::jsonb),
    'privacyReview', jsonb_build_object(
      'required', v_legacy_linked_snapshots + v_mismatched_linked_snapshots
        + v_omitted_jobs + v_omitted_drafts + v_omitted_versions + v_omitted_dispatches > 0,
      'reason', case
        when v_legacy_linked_snapshots + v_mismatched_linked_snapshots > 0
          then 'linked_snapshot_subject_email_unverified'
        when v_omitted_jobs + v_omitted_drafts + v_omitted_versions + v_omitted_dispatches > 0
          then 'cross_subject_linked_records_omitted'
        else null
      end,
      'omittedCounts', jsonb_build_object(
        'researchSnapshots', v_legacy_linked_snapshots + v_mismatched_linked_snapshots,
        'legacyResearchSnapshots', v_legacy_linked_snapshots,
        'mismatchedResearchSnapshots', v_mismatched_linked_snapshots,
        'researchJobs', v_omitted_jobs,
        'messagingDrafts', v_omitted_drafts,
        'messagingDraftVersions', v_omitted_versions,
        'outboundDispatches', v_omitted_dispatches
      )
    )
  );
end;
$$;

revoke all on function public.lookup_research_messaging_subject_v1(text) from public;
grant execute on function public.lookup_research_messaging_subject_v1(text) to service_role;

create or replace function public.repair_reconciled_sent_dispatch_history_v1(
  p_dispatch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.outbound_dispatches%rowtype;
  v_version public.messaging_draft_versions%rowtype;
  v_existing_contact public.contacted_leads%rowtype;
  v_origin_contact public.contacted_leads%rowtype;
  v_owned_lead public.leads%rowtype;
  v_campaign public.campaigns%rowtype;
  v_antonia_task public.antonia_tasks%rowtype;
  v_email text;
  v_metadata_email text;
  v_version_email text;
  v_subject text;
  v_lead_ref text;
  v_sent_at timestamptz;
  v_message_id text;
  v_thread_id text;
  v_conversation_id text;
  v_internet_message_id text;
  v_thread_key text;
  v_source text := 'outbound_reconciliation';
  v_contacted_id text;
  v_event_id uuid;
  v_hash text;
  v_name text;
  v_company text;
  v_role text;
  v_mission_id uuid;
  v_campaign_id text;
  v_campaign_lead_key text;
  v_campaign_step integer;
  v_current_campaign_step integer;
  v_antonia_task_id uuid;
  v_recipient_key text;
  v_suplia_origin_id text;
  v_current_campaign_record jsonb := '{}'::jsonb;
  v_contact_data jsonb := '{}'::jsonb;
  v_last_event_at timestamptz;
  v_lead_updated boolean := false;
  v_campaign_updated boolean := false;
  v_existing_contact_found boolean := false;
  v_origin_contact_found boolean := false;
  v_campaign_found boolean := false;
  v_affected integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_dispatch_id is null then
    raise exception 'dispatch id is required' using errcode = '22023';
  end if;

  -- This first read derives the lock key only. Every eligibility check and write is repeated under the lock.
  select od.* into v_dispatch
  from public.outbound_dispatches od
  where od.id = p_dispatch_id;
  if not found then
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'dispatch_missing');
  end if;
  select mdv.* into v_version
  from public.messaging_draft_versions mdv
  where mdv.id = v_dispatch.version_id
    and mdv.draft_id = v_dispatch.draft_id
    and mdv.organization_id = v_dispatch.organization_id
    and mdv.user_id = v_dispatch.user_id;

  v_metadata_email := lower(trim(coalesce(v_dispatch.metadata #>> '{recipient,email}', '')));
  v_version_email := lower(trim(coalesce(v_version.recipient ->> 'email', '')));
  v_email := coalesce(nullif(v_version_email, ''), nullif(v_metadata_email, ''));
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'reconciled email dispatch has no valid recipient email' using errcode = '22023';
  end if;
  if v_metadata_email <> '' and v_version_email <> '' and v_metadata_email <> v_version_email then
    raise exception 'draft recipient does not match reconciled dispatch metadata' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));

  select od.* into v_dispatch
  from public.outbound_dispatches od
  where od.id = p_dispatch_id
  for update;
  if not found then
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'dispatch_missing');
  end if;
  select mdv.* into v_version
  from public.messaging_draft_versions mdv
  where mdv.id = v_dispatch.version_id
    and mdv.draft_id = v_dispatch.draft_id
    and mdv.organization_id = v_dispatch.organization_id
    and mdv.user_id = v_dispatch.user_id;
  if not found then
    raise exception 'reconciled dispatch draft version is missing' using errcode = '55000';
  end if;

  v_metadata_email := lower(trim(coalesce(v_dispatch.metadata #>> '{recipient,email}', '')));
  v_version_email := lower(trim(coalesce(v_version.recipient ->> 'email', '')));
  if v_email is distinct from coalesce(nullif(v_version_email, ''), nullif(v_metadata_email, ''))
    or (v_metadata_email <> '' and v_version_email <> '' and v_metadata_email <> v_version_email) then
    raise exception 'dispatch recipient changed while acquiring privacy lock' using errcode = '55000';
  end if;

  if v_dispatch.status <> 'sent' or v_dispatch.reconciled_at is null or v_dispatch.channel <> 'email' then
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'not_reconciled_sent');
  end if;
  if v_dispatch.history_repair_status = 'complete' then
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'already_complete');
  end if;

  if exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(coalesce(ue.email, ''))) = v_email
      and ue.user_id is null
      and ue.organization_id is null
  ) then
    update public.outbound_dispatches
    set history_repair_status = 'complete',
        history_repair_attempt_count = history_repair_attempt_count + 1,
        last_history_repair_at = now(),
        history_repair_error = null
    where id = p_dispatch_id
      and status = 'sent'
      and history_repair_status in ('pending', 'failed')
      and history_repair_attempt_count = v_dispatch.history_repair_attempt_count;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'history repair suppression bookkeeping compare-and-set failed' using errcode = '40001';
    end if;
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'globally_suppressed');
  end if;

  v_subject := trim(coalesce(v_version.content ->> 'subject', ''));
  if v_subject = '' then
    raise exception 'reconciled email dispatch draft has no subject' using errcode = '22023';
  end if;
  v_lead_ref := trim(coalesce(
    nullif(v_dispatch.metadata #>> '{recipient,leadRef}', ''),
    nullif(v_version.recipient ->> 'leadRef', ''),
    ''
  ));
  v_sent_at := case
    when public.research_messaging_is_iso_timestamptz_v1(coalesce(v_dispatch.reconciliation_details ->> 'sentAt', ''))
      then (v_dispatch.reconciliation_details ->> 'sentAt')::timestamptz
    else coalesce(v_dispatch.completed_at, v_dispatch.reconciled_at, v_dispatch.requested_at)
  end;
  v_message_id := nullif(trim(coalesce(
    v_dispatch.provider_response ->> 'id',
    v_dispatch.provider_response ->> 'messageId',
    v_dispatch.provider_message_id,
    ''
  )), '');
  v_thread_id := nullif(trim(coalesce(v_dispatch.provider_response ->> 'threadId', '')), '');
  v_conversation_id := nullif(trim(coalesce(v_dispatch.provider_response ->> 'conversationId', '')), '');
  v_internet_message_id := nullif(trim(coalesce(v_dispatch.provider_response ->> 'internetMessageId', '')), '');
  v_thread_key := case
    when lower(v_dispatch.provider) = 'gmail' and v_thread_id is not null then concat('gmail:', v_thread_id)
    when lower(v_dispatch.provider) = 'outlook' and v_conversation_id is not null then concat('outlook:', v_conversation_id)
    when v_internet_message_id is not null then concat('msg:', trim(both '<>' from v_internet_message_id))
    when v_message_id is not null then concat(lower(v_dispatch.provider), ':', v_message_id)
    else null
  end;

  if v_dispatch.idempotency_key ~* '^campaign:[^:]+:[^:]+:step:[0-9]+$' then
    v_source := 'campaign';
    v_campaign_id := split_part(v_dispatch.idempotency_key, ':', 2);
    v_contacted_id := split_part(v_dispatch.idempotency_key, ':', 3);
    v_campaign_step := split_part(v_dispatch.idempotency_key, ':', 5)::integer;
  elsif v_dispatch.idempotency_key ~* '^antonia:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:.+:initial$' then
    v_source := 'antonia';
    v_antonia_task_id := split_part(v_dispatch.idempotency_key, ':', 2)::uuid;
    v_recipient_key := lower(split_part(v_dispatch.idempotency_key, ':', 3));
  elsif v_dispatch.idempotency_key like 'suplia:%' then
    v_source := 'suplia';
    v_suplia_origin_id := split_part(v_dispatch.idempotency_key, ':', 2);
    v_recipient_key := lower(split_part(v_dispatch.idempotency_key, ':', 3));
  end if;

  if v_lead_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into v_owned_lead
    from public.leads l
    where l.id = v_lead_ref::uuid
      and l.user_id = v_dispatch.user_id
      and l.organization_id = v_dispatch.organization_id
      and lower(trim(coalesce(l.email, ''))) = v_email
    for update;
  end if;

  select * into v_existing_contact
  from public.contacted_leads cl
  where cl.organization_id = v_dispatch.organization_id
    and cl.user_id = v_dispatch.user_id
    and cl.data @> jsonb_build_object('dispatchId', v_dispatch.id::text)
  order by cl.created_at asc
  limit 1
  for update;
  v_existing_contact_found := found;

  if v_source = 'campaign' then
    select * into v_origin_contact
    from public.contacted_leads cl
    where cl.id = v_contacted_id
      and cl.organization_id = v_dispatch.organization_id
      and cl.user_id = v_dispatch.user_id
      and lower(trim(coalesce(cl.email, ''))) = v_email
    for update;
    v_origin_contact_found := found;
    if not v_existing_contact_found and v_origin_contact_found then
      v_existing_contact := v_origin_contact;
      v_existing_contact_found := true;
    end if;
    if v_origin_contact_found then
      select * into v_campaign
      from public.campaigns c
      where c.id::text = v_campaign_id
        and c.user_id = v_dispatch.user_id
        and c.organization_id = v_dispatch.organization_id
      for update;
      v_campaign_found := found;
      v_campaign_lead_key := coalesce(nullif(trim(v_origin_contact.lead_id), ''), v_origin_contact.id);
    end if;
  elsif v_source = 'antonia'
    and (v_recipient_key = lower(v_lead_ref) or v_recipient_key = v_email) then
    select * into v_antonia_task
    from public.antonia_tasks at
    where at.id = v_antonia_task_id
      and at.organization_id = v_dispatch.organization_id
      and at.payload ->> 'userId' = v_dispatch.user_id::text;
    if found then
      v_mission_id := coalesce(v_antonia_task.mission_id, v_existing_contact.mission_id, v_owned_lead.mission_id);
      if v_owned_lead.id is not null and nullif(trim(v_antonia_task.payload ->> 'campaignName'), '') is not null
        and (
          select count(*)
          from public.campaigns c
          where c.name = v_antonia_task.payload ->> 'campaignName'
            and c.user_id = v_dispatch.user_id
            and c.organization_id = v_dispatch.organization_id
        ) = 1 then
        select * into v_campaign
        from public.campaigns c
        where c.name = v_antonia_task.payload ->> 'campaignName'
          and c.user_id = v_dispatch.user_id
          and c.organization_id = v_dispatch.organization_id
        for update;
        v_campaign_found := found;
        v_campaign_lead_key := v_owned_lead.id::text;
        v_campaign_step := 0;
      end if;
    end if;
  end if;

  if not v_existing_contact_found then
    v_hash := encode(digest(to_jsonb(concat('reconciliation:contacted:', v_dispatch.id::text))::text, 'sha256'), 'hex');
    v_contacted_id := format(
      '%s-%s-4%s-8%s-%s',
      substr(v_hash, 1, 8), substr(v_hash, 9, 4), substr(v_hash, 14, 3),
      substr(v_hash, 18, 3), substr(v_hash, 21, 12)
    );
  else
    v_contacted_id := v_existing_contact.id;
  end if;

  v_mission_id := coalesce(v_mission_id, v_existing_contact.mission_id, v_owned_lead.mission_id);
  v_last_event_at := greatest(coalesce(v_existing_contact.last_event_at, v_sent_at), v_sent_at);
  v_contact_data := coalesce(v_existing_contact.data, '{}'::jsonb) || jsonb_build_object(
    'source', coalesce(nullif(v_existing_contact.data ->> 'source', ''), v_source),
    'dispatchId', coalesce(nullif(v_existing_contact.data ->> 'dispatchId', ''), v_dispatch.id::text),
    'reconciliationDispatchId', v_dispatch.id::text,
    'draftId', v_dispatch.draft_id::text,
    'draftVersionId', v_dispatch.version_id::text,
    'contentHash', v_dispatch.content_hash,
    'idempotencyKey', v_dispatch.idempotency_key,
    'leadRef', nullif(v_lead_ref, ''),
    'reconciledAt', v_dispatch.reconciled_at,
    'historyRepairSource', 'outbound_reconciliation'
  );
  if v_source = 'suplia' and v_recipient_key = v_email then
    v_contact_data := v_contact_data || jsonb_build_object('supliaOriginId', v_suplia_origin_id);
  end if;
  v_name := coalesce(nullif(v_existing_contact.name, ''), nullif(v_owned_lead.name, ''), nullif(v_dispatch.metadata #>> '{recipient,displayName}', ''), nullif(v_version.recipient ->> 'displayName', ''));
  v_company := coalesce(nullif(v_existing_contact.company, ''), nullif(v_owned_lead.company, ''));
  v_role := coalesce(nullif(v_existing_contact.role, ''), nullif(v_owned_lead.title, ''));

  insert into public.contacted_leads as target (
    id, user_id, organization_id, lead_id, mission_id, name, email, company, role,
    status, provider, subject, message_id, thread_id, conversation_id, internet_message_id,
    thread_key, lifecycle_state, last_event_type, last_event_at, sent_at, created_at, data,
    last_follow_up_at, last_step_idx, follow_up_count
  ) values (
    v_contacted_id,
    v_dispatch.user_id,
    v_dispatch.organization_id,
    coalesce(v_owned_lead.id::text, v_existing_contact.lead_id),
    v_mission_id,
    v_name,
    v_email,
    v_company,
    v_role,
    coalesce(nullif(v_existing_contact.status, ''), 'sent'),
    v_dispatch.provider,
    coalesce(nullif(v_existing_contact.subject, ''), v_subject),
    coalesce(v_message_id, v_existing_contact.message_id),
    coalesce(v_thread_id, v_existing_contact.thread_id),
    coalesce(v_conversation_id, v_existing_contact.conversation_id),
    coalesce(v_internet_message_id, v_existing_contact.internet_message_id),
    coalesce(v_thread_key, v_existing_contact.thread_key),
    coalesce(nullif(v_existing_contact.lifecycle_state, ''), 'sent'),
    case when v_existing_contact.last_event_at >= v_sent_at then coalesce(v_existing_contact.last_event_type, 'sent') else 'sent' end,
    v_last_event_at,
    coalesce(v_existing_contact.sent_at, v_sent_at),
    coalesce(v_existing_contact.created_at, v_sent_at),
    v_contact_data,
    case when v_source = 'campaign' and v_origin_contact_found then greatest(coalesce(v_existing_contact.last_follow_up_at, v_sent_at), v_sent_at) else v_existing_contact.last_follow_up_at end,
    case when v_source = 'campaign' and v_origin_contact_found then greatest(coalesce(v_existing_contact.last_step_idx, -1), v_campaign_step) else v_existing_contact.last_step_idx end,
    case when v_source = 'campaign' and v_origin_contact_found then greatest(coalesce(v_existing_contact.follow_up_count, 0), v_campaign_step + 1) else coalesce(v_existing_contact.follow_up_count, 0) end
  )
  on conflict (id) do update set
    lead_id = coalesce(excluded.lead_id, target.lead_id),
    mission_id = coalesce(excluded.mission_id, target.mission_id),
    name = coalesce(nullif(excluded.name, ''), target.name),
    email = excluded.email,
    company = coalesce(nullif(excluded.company, ''), target.company),
    role = coalesce(nullif(excluded.role, ''), target.role),
    status = coalesce(nullif(target.status, ''), excluded.status),
    provider = excluded.provider,
    subject = coalesce(nullif(target.subject, ''), excluded.subject),
    message_id = coalesce(excluded.message_id, target.message_id),
    thread_id = coalesce(excluded.thread_id, target.thread_id),
    conversation_id = coalesce(excluded.conversation_id, target.conversation_id),
    internet_message_id = coalesce(excluded.internet_message_id, target.internet_message_id),
    thread_key = coalesce(excluded.thread_key, target.thread_key),
    lifecycle_state = coalesce(nullif(target.lifecycle_state, ''), excluded.lifecycle_state),
    last_event_type = case when target.last_event_at >= v_sent_at then target.last_event_type else excluded.last_event_type end,
    last_event_at = greatest(coalesce(target.last_event_at, excluded.last_event_at), excluded.last_event_at),
    sent_at = coalesce(target.sent_at, excluded.sent_at),
    data = excluded.data,
    last_follow_up_at = greatest(coalesce(target.last_follow_up_at, excluded.last_follow_up_at), excluded.last_follow_up_at),
    last_step_idx = greatest(coalesce(target.last_step_idx, excluded.last_step_idx), excluded.last_step_idx),
    follow_up_count = greatest(coalesce(target.follow_up_count, excluded.follow_up_count), excluded.follow_up_count);

  if v_owned_lead.id is not null
    and not (
      lower(coalesce(v_owned_lead.status, '')) in ('contacted', 'replied', 'do_not_contact', 'converted', 'closed_won', 'closed_lost')
      and coalesce(v_owned_lead.last_contacted_at >= v_sent_at, false)
    ) then
    update public.leads
    set last_contacted_at = greatest(coalesce(last_contacted_at, v_sent_at), v_sent_at),
        status = case
          when lower(coalesce(status, '')) in ('contacted', 'replied', 'do_not_contact', 'converted', 'closed_won', 'closed_lost') then status
          else 'contacted'
        end
    where id = v_owned_lead.id
      and user_id = v_dispatch.user_id
      and organization_id = v_dispatch.organization_id;
    v_lead_updated := found;
  end if;

  if v_campaign_found and v_campaign_lead_key <> '' then
    v_current_campaign_record := coalesce(v_campaign.sent_records -> v_campaign_lead_key, '{}'::jsonb);
    v_current_campaign_step := case
      when coalesce(v_current_campaign_record ->> 'lastStepIdx', '') ~ '^-?[0-9]+$'
        then (v_current_campaign_record ->> 'lastStepIdx')::integer
      else null
    end;
    if coalesce(v_current_campaign_step, -1) <= v_campaign_step then
      update public.campaigns
      set sent_records = jsonb_set(
            coalesce(sent_records, '{}'::jsonb),
            array[v_campaign_lead_key],
            v_current_campaign_record || jsonb_build_object(
              'lastStepIdx', v_campaign_step,
              'lastSentAt', case
                when v_current_campaign_step = v_campaign_step
                  and nullif(v_current_campaign_record ->> 'lastSentAt', '') is not null
                  then v_current_campaign_record ->> 'lastSentAt'
                else to_char(v_sent_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
              end
            ),
            true
          ),
          updated_at = now()
      where id = v_campaign.id
        and user_id = v_dispatch.user_id
        and organization_id = v_dispatch.organization_id;
      v_campaign_updated := found;
    end if;
  end if;

  select ee.id into v_event_id
  from public.email_events ee
  where ee.organization_id = v_dispatch.organization_id
    and ee.event_type = 'sent'
    and ee.meta @> jsonb_build_object('dispatchId', v_dispatch.id::text)
  order by ee.created_at asc
  limit 1;
  if not found then
    v_hash := encode(digest(to_jsonb(concat('reconciliation:email-event:sent:', v_dispatch.id::text))::text, 'sha256'), 'hex');
    v_event_id := format(
      '%s-%s-4%s-8%s-%s',
      substr(v_hash, 1, 8), substr(v_hash, 9, 4), substr(v_hash, 14, 3),
      substr(v_hash, 18, 3), substr(v_hash, 21, 12)
    )::uuid;
    insert into public.email_events (
      id, organization_id, mission_id, contacted_id, lead_id, provider, event_type,
      event_source, event_at, thread_key, message_id, internet_message_id, meta
    ) values (
      v_event_id, v_dispatch.organization_id, v_mission_id, v_contacted_id,
      coalesce(v_owned_lead.id::text, v_existing_contact.lead_id), v_dispatch.provider, 'sent',
      'outbound_reconciliation', v_sent_at, v_thread_key, v_message_id, v_internet_message_id,
      jsonb_build_object(
        'source', v_source,
        'subject', v_subject,
        'dispatchId', v_dispatch.id::text,
        'draftId', v_dispatch.draft_id::text,
        'draftVersionId', v_dispatch.version_id::text,
        'contentHash', v_dispatch.content_hash,
        'idempotencyKey', v_dispatch.idempotency_key,
        'leadRef', nullif(v_lead_ref, '')
      ) || case
        when v_campaign_found then jsonb_build_object('campaignId', v_campaign.id, 'stepIndex', v_campaign_step)
        else '{}'::jsonb
      end
    ) on conflict (id) do nothing;
  end if;

  update public.outbound_dispatches
  set history_repair_status = 'complete',
      history_repair_attempt_count = history_repair_attempt_count + 1,
      last_history_repair_at = now(),
      history_repair_error = null
  where id = p_dispatch_id
    and status = 'sent'
    and history_repair_status in ('pending', 'failed')
    and history_repair_attempt_count = v_dispatch.history_repair_attempt_count;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'history repair bookkeeping compare-and-set failed' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'repaired', true,
    'finalized', true,
    'contactedId', v_contacted_id,
    'eventId', v_event_id,
    'leadUpdated', v_lead_updated,
    'campaignUpdated', v_campaign_updated
  );
end;
$$;

revoke all on function public.repair_reconciled_sent_dispatch_history_v1(uuid) from public;
grant execute on function public.repair_reconciled_sent_dispatch_history_v1(uuid) to service_role;

create or replace function public.delete_research_messaging_subject_v1(
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_linked_snapshot_ids uuid[] := '{}'::uuid[];
  v_snapshot_ids uuid[] := '{}'::uuid[];
  v_direct_draft_ids uuid[] := '{}'::uuid[];
  v_draft_ids uuid[] := '{}'::uuid[];
  v_research_snapshots integer := 0;
  v_research_jobs integer := 0;
  v_messaging_drafts integer := 0;
  v_messaging_draft_versions integer := 0;
  v_outbound_dispatches integer := 0;
  v_lead_research_reports integer := 0;
  v_enriched_leads integer := 0;
  v_contacted_leads integer := 0;
  v_leads integer := 0;
  v_lead_responses integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));
  insert into public.unsubscribed_emails (email, reason)
  select v_email, 'privacy_request_delete_preserve_block'
  where not exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(ue.email)) = v_email
      and ue.user_id is null
      and ue.organization_id is null
  )
  on conflict do nothing;

  select coalesce(array_agg(distinct candidate.draft_id), '{}'::uuid[])
  into v_direct_draft_ids
  from (
    select mdv.draft_id
    from public.messaging_draft_versions mdv
    where lower(trim(coalesce(mdv.recipient ->> 'email', ''))) = v_email
    union
    select od.draft_id
    from public.outbound_dispatches od
    where lower(trim(coalesce(od.metadata #>> '{recipient,email}', ''))) = v_email
  ) candidate;

  select coalesce(
    array_agg(distinct candidate.snapshot_id) filter (where candidate.snapshot_id is not null),
    '{}'::uuid[]
  )
  into v_linked_snapshot_ids
  from (
    select lrj.research_snapshot_id as snapshot_id
    from public.lead_research_jobs lrj
    where lower(trim(coalesce(lrj.email, ''))) = v_email
    union
    select md.research_snapshot_id
    from public.messaging_drafts md
    where md.id = any(v_direct_draft_ids)
    union
    select mdv.research_snapshot_id
    from public.messaging_draft_versions mdv
    where mdv.draft_id = any(v_direct_draft_ids)
  ) candidate;

  if exists (
    select 1
    from public.research_snapshots rs
    where rs.id = any(v_linked_snapshot_ids)
      and nullif(trim(coalesce(rs.payload #>> '{subject,email}', '')), '') is null
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'blocked', true,
      'reason', 'linked_legacy_snapshot_missing_subject_email'
    );
  end if;
  if exists (
    select 1
    from public.research_snapshots rs
    where rs.id = any(v_linked_snapshot_ids)
      and nullif(trim(coalesce(rs.payload #>> '{subject,email}', '')), '') is not null
      and lower(trim(rs.payload #>> '{subject,email}')) <> v_email
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'blocked', true,
      'reason', 'linked_snapshot_subject_email_mismatch'
    );
  end if;

  select coalesce(array_agg(rs.id), '{}'::uuid[])
  into v_snapshot_ids
  from public.research_snapshots rs
  where lower(trim(coalesce(rs.payload #>> '{subject,email}', ''))) = v_email;

  perform 1
  from public.research_snapshots rs
  where rs.id = any(v_snapshot_ids)
  for update;
  perform 1
  from public.messaging_drafts md
  where md.id = any(v_direct_draft_ids)
  for update;

  if exists (
    select 1
    from public.messaging_drafts md
    where md.research_snapshot_id = any(v_snapshot_ids)
      and not exists (
        select 1
        from public.messaging_draft_versions mdv
        where mdv.draft_id = md.id
          and lower(trim(coalesce(mdv.recipient ->> 'email', ''))) = v_email
      )
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'blocked', true,
      'reason', 'snapshot_linked_messaging_draft'
    );
  end if;
  if exists (
    select 1
    from public.messaging_draft_versions mdv
    where mdv.research_snapshot_id = any(v_snapshot_ids)
      and not (mdv.draft_id = any(v_direct_draft_ids))
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'blocked', true,
      'reason', 'snapshot_linked_draft_version'
    );
  end if;

  select coalesce(array_agg(distinct candidate.draft_id), '{}'::uuid[])
  into v_draft_ids
  from (
    select unnest(v_direct_draft_ids) as draft_id
    union
    select md.id as draft_id
    from public.messaging_drafts md
    where md.research_snapshot_id = any(v_snapshot_ids)
    union
    select mdv.draft_id
    from public.messaging_draft_versions mdv
    where mdv.research_snapshot_id = any(v_snapshot_ids)
       or lower(trim(coalesce(mdv.recipient ->> 'email', ''))) = v_email
  ) candidate;

  perform 1
  from public.messaging_drafts md
  where md.id = any(v_draft_ids)
  for update;

  if exists (
    select 1
    from public.messaging_draft_versions mdv
    where mdv.draft_id = any(v_draft_ids)
      and coalesce(lower(trim(mdv.recipient ->> 'email')), '') not in ('', v_email)
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'blocked', true,
      'reason', 'mixed_subject_messaging_draft'
    );
  end if;
  if exists (
    select 1
    from public.lead_research_jobs lrj
    where lrj.research_snapshot_id = any(v_snapshot_ids)
      and lower(trim(coalesce(lrj.email, ''))) not in ('', v_email)
  ) then
    return jsonb_build_object(
      'outcome', 'manual_review',
      'blocked', true,
      'reason', 'cross_subject_research_snapshot_reference'
    );
  end if;

  select count(*) into v_outbound_dispatches
  from public.outbound_dispatches od
  where od.draft_id = any(v_draft_ids)
    or lower(trim(coalesce(od.metadata #>> '{recipient,email}', ''))) = v_email;

  select count(*) into v_messaging_draft_versions
  from public.messaging_draft_versions mdv
  where mdv.draft_id = any(v_draft_ids);

  select count(*) into v_messaging_drafts
  from public.messaging_drafts md
  where md.id = any(v_draft_ids);

  select count(*) into v_research_jobs
  from public.lead_research_jobs lrj
  where lower(trim(coalesce(lrj.email, ''))) = v_email
     or lrj.research_snapshot_id = any(v_snapshot_ids);

  select count(*) into v_research_snapshots
  from public.research_snapshots rs
  where rs.id = any(v_snapshot_ids);

  with campaign_keys as (
    select c.id as campaign_id, cl.id as recipient_key
    from public.campaigns c
    join public.contacted_leads cl
      on cl.user_id = c.user_id
     and cl.organization_id is not distinct from c.organization_id
    where lower(trim(coalesce(cl.email, ''))) = v_email
      and coalesce(c.sent_records, '{}'::jsonb) ? cl.id
    union
    select c.id, cl.lead_id
    from public.campaigns c
    join public.contacted_leads cl
      on cl.user_id = c.user_id
     and cl.organization_id is not distinct from c.organization_id
    where lower(trim(coalesce(cl.email, ''))) = v_email
      and nullif(trim(cl.lead_id), '') is not null
      and coalesce(c.sent_records, '{}'::jsonb) ? cl.lead_id
    union
    select c.id, l.id::text
    from public.campaigns c
    join public.leads l
      on l.user_id = c.user_id
     and l.organization_id is not distinct from c.organization_id
    where lower(trim(coalesce(l.email, ''))) = v_email
      and coalesce(c.sent_records, '{}'::jsonb) ? l.id::text
  ), grouped_campaign_keys as (
    select campaign_id, array_agg(recipient_key) as recipient_keys
    from campaign_keys
    group by campaign_id
  )
  update public.campaigns c
  set sent_records = coalesce(c.sent_records, '{}'::jsonb) - grouped.recipient_keys,
      updated_at = now()
  from grouped_campaign_keys grouped
  where c.id = grouped.campaign_id;

  perform set_config('app.privacy_delete', 'on', true);

  delete from public.outbound_dispatches od
  where od.draft_id = any(v_draft_ids)
    or lower(trim(coalesce(od.metadata #>> '{recipient,email}', ''))) = v_email;

  delete from public.lead_research_jobs lrj
  where lower(trim(coalesce(lrj.email, ''))) = v_email
     or lrj.research_snapshot_id = any(v_snapshot_ids);

  update public.messaging_drafts md
  set current_version_id = null
  where md.id = any(v_draft_ids);

  delete from public.messaging_drafts md
  where md.id = any(v_draft_ids);

  delete from public.research_snapshots rs
  where rs.id = any(v_snapshot_ids);

  with deleted as (
    delete from public.lead_responses lr
    where lr.contacted_id in (
      select cl.id
      from public.contacted_leads cl
      where lower(trim(coalesce(cl.email, ''))) = v_email
      )
    returning id
  ) select count(*) into v_lead_responses from deleted;

  with deleted as (
    delete from public.lead_research_reports where lower(trim(coalesce(email, ''))) = v_email returning report_id
  ) select count(*) into v_lead_research_reports from deleted;
  with deleted as (
    delete from public.enriched_leads where lower(trim(coalesce(email, ''))) = v_email returning id
  ) select count(*) into v_enriched_leads from deleted;
  with deleted as (
    delete from public.contacted_leads where lower(trim(coalesce(email, ''))) = v_email returning id
  ) select count(*) into v_contacted_leads from deleted;
  with deleted as (
    delete from public.leads where lower(trim(coalesce(email, ''))) = v_email returning id
  ) select count(*) into v_leads from deleted;

  delete from public.unsubscribed_emails ue
  where lower(trim(ue.email)) = v_email
    and (ue.user_id is not null or ue.organization_id is not null);

  return jsonb_build_object(
    'outcome', 'deleted',
    'blocked', true,
    'researchSnapshots', v_research_snapshots,
    'researchJobs', v_research_jobs,
    'messagingDrafts', v_messaging_drafts,
    'messagingDraftVersions', v_messaging_draft_versions,
    'outboundDispatches', v_outbound_dispatches,
    'leadResearchReports', v_lead_research_reports,
    'enrichedLeads', v_enriched_leads,
    'contactedLeads', v_contacted_leads,
    'leads', v_leads,
    'leadResponses', v_lead_responses
  );
end;
$$;

create or replace function public.delete_research_messaging_retention_v1(
  p_resource text,
  p_cutoff timestamptz,
  p_dry_run boolean default false,
  p_dispatch_cutoff timestamptz default null,
  p_draft_cutoff timestamptz default null,
  p_job_cutoff timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matched integer := 0;
  v_deleted integer := 0;
  v_draft_ids uuid[] := '{}'::uuid[];
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_cutoff is null then
    raise exception 'cutoff is required' using errcode = '22023';
  end if;
  if p_dry_run and p_resource in ('messaging_drafts', 'research_snapshots')
    and (p_dispatch_cutoff is null or p_draft_cutoff is null or p_job_cutoff is null) then
    raise exception 'dependent retention cutoffs are required for dry run' using errcode = '22023';
  end if;

  if not p_dry_run then
    perform set_config('app.privacy_delete', 'on', true);
  end if;

  -- Each branch reports exactly the rows it can delete in this invocation.

  if p_resource = 'outbound_dispatches' then
    select count(*) into v_matched
    from public.outbound_dispatches od
    where od.status in ('sent', 'failed', 'unknown')
      and od.completed_at < p_cutoff;

    if not p_dry_run then
      with deleted as (
        delete from public.outbound_dispatches od
        where od.status in ('sent', 'failed', 'unknown')
          and od.completed_at < p_cutoff
        returning id
      ) select count(*) into v_deleted from deleted;
    end if;
  elsif p_resource = 'messaging_drafts' then
    select coalesce(array_agg(md.id), '{}'::uuid[])
    into v_draft_ids
    from public.messaging_drafts md
    where md.updated_at < p_cutoff
      and not exists (
        select 1 from public.outbound_dispatches od
        where od.draft_id = md.id
          and (not p_dry_run or not (
            od.status in ('sent', 'failed', 'unknown') and od.completed_at < p_dispatch_cutoff
          ))
      );
    v_matched := coalesce(array_length(v_draft_ids, 1), 0);

    if not p_dry_run then
      update public.messaging_drafts md
      set current_version_id = null
      where md.id = any(v_draft_ids);

      with deleted as (
        delete from public.messaging_drafts md
        where md.id = any(v_draft_ids)
        returning id
      ) select count(*) into v_deleted from deleted;
    end if;
  elsif p_resource = 'lead_research_jobs' then
    select count(*) into v_matched
    from public.lead_research_jobs lrj
    where lrj.status in ('completed', 'partial', 'insufficient_data', 'failed', 'cancelled')
      and lrj.completed_at < p_cutoff;

    if not p_dry_run then
      with deleted as (
        delete from public.lead_research_jobs lrj
        where lrj.status in ('completed', 'partial', 'insufficient_data', 'failed', 'cancelled')
          and lrj.completed_at < p_cutoff
        returning id
      ) select count(*) into v_deleted from deleted;
    end if;
  elsif p_resource = 'research_snapshots' then
    select count(*) into v_matched
    from public.research_snapshots rs
    where rs.captured_at < p_cutoff
      and not exists (
        select 1 from public.messaging_drafts md
        where md.research_snapshot_id = rs.id
          and (not p_dry_run or not (
            md.updated_at < p_draft_cutoff
            and not exists (
              select 1 from public.outbound_dispatches od
              where od.draft_id = md.id
                and not (od.status in ('sent', 'failed', 'unknown') and od.completed_at < p_dispatch_cutoff)
            )
          ))
      )
      and not exists (
        select 1 from public.messaging_draft_versions mdv
        join public.messaging_drafts md on md.id = mdv.draft_id
        where mdv.research_snapshot_id = rs.id
          and (not p_dry_run or not (
            md.updated_at < p_draft_cutoff
            and not exists (
              select 1 from public.outbound_dispatches od
              where od.draft_id = md.id
                and not (od.status in ('sent', 'failed', 'unknown') and od.completed_at < p_dispatch_cutoff)
            )
          ))
      )
      and not exists (
        select 1 from public.lead_research_jobs lrj
        where lrj.research_snapshot_id = rs.id
          and (not p_dry_run or not (
            lrj.status in ('completed', 'partial', 'insufficient_data', 'failed', 'cancelled')
            and lrj.completed_at < p_job_cutoff
          ))
      );

    if not p_dry_run then
      with deleted as (
        delete from public.research_snapshots rs
        where rs.captured_at < p_cutoff
          and not exists (
            select 1 from public.messaging_drafts md where md.research_snapshot_id = rs.id
          )
          and not exists (
            select 1 from public.messaging_draft_versions mdv where mdv.research_snapshot_id = rs.id
          )
          and not exists (
            select 1 from public.lead_research_jobs lrj where lrj.research_snapshot_id = rs.id
          )
        returning id
      ) select count(*) into v_deleted from deleted;
    end if;
  else
    raise exception 'unsupported retention resource' using errcode = '22023';
  end if;

  return jsonb_build_object('matchedCount', v_matched, 'deletedCount', v_deleted);
end;
$$;

revoke all on function public.delete_research_messaging_subject_v1(text) from public;
revoke all on function public.delete_research_messaging_retention_v1(text, timestamptz, boolean, timestamptz, timestamptz, timestamptz) from public;
grant execute on function public.delete_research_messaging_subject_v1(text) to service_role;
grant execute on function public.delete_research_messaging_retention_v1(text, timestamptz, boolean, timestamptz, timestamptz, timestamptz) to service_role;

create or replace function public.claim_outbound_dispatch_reconciliation_v1(
  p_dispatch_id uuid,
  p_expected_status text,
  p_expected_attempt_count integer,
  p_stale_sending_before timestamptz,
  p_stale_claim_before timestamptz,
  p_claimed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.outbound_dispatches%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_expected_status is null
    or p_expected_status not in ('sending', 'unknown')
    or p_expected_attempt_count is null
    or p_expected_attempt_count < 0
    or p_claimed_at is null
    or p_stale_claim_before is null
    or (p_expected_status = 'sending' and p_stale_sending_before is null) then
    raise exception 'invalid reconciliation claim input' using errcode = '22023';
  end if;

  update public.outbound_dispatches od
  set status = 'unknown',
      error_code = case when od.status = 'sending' then 'worker_interrupted' else od.error_code end,
      error_message = case
        when od.status = 'sending' then 'Dispatch remained in sending state beyond the reconciliation threshold.'
        else od.error_message
      end,
      completed_at = coalesce(od.completed_at, p_claimed_at),
      reconciliation_claimed_at = p_claimed_at,
      updated_at = case when od.status = 'sending' then p_claimed_at else od.updated_at end
  where od.id = p_dispatch_id
    and od.status = p_expected_status
    and od.reconciliation_attempt_count = p_expected_attempt_count
    and (od.reconciliation_claimed_at is null or od.reconciliation_claimed_at < p_stale_claim_before)
    and (
      (p_expected_status = 'unknown')
      or (p_expected_status = 'sending' and od.updated_at < p_stale_sending_before)
    )
  returning od.* into v_dispatch;

  if not found then return null; end if;
  return to_jsonb(v_dispatch);
end;
$$;

revoke all on function public.claim_outbound_dispatch_reconciliation_v1(uuid, text, integer, timestamptz, timestamptz, timestamptz) from public;
grant execute on function public.claim_outbound_dispatch_reconciliation_v1(uuid, text, integer, timestamptz, timestamptz, timestamptz) to service_role;

create or replace function public.abandon_outbound_dispatch_reconciliation_v1(
  p_dispatch_id uuid,
  p_expected_attempt_count integer,
  p_claimed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.outbound_dispatches od
  set reconciliation_claimed_at = null
  where od.id = p_dispatch_id
    and od.status = 'unknown'
    and od.reconciliation_attempt_count = p_expected_attempt_count
    and od.reconciliation_claimed_at = p_claimed_at;
  return found;
end;
$$;

revoke all on function public.abandon_outbound_dispatch_reconciliation_v1(uuid, integer, timestamptz) from public;
grant execute on function public.abandon_outbound_dispatch_reconciliation_v1(uuid, integer, timestamptz) to service_role;

create or replace function public.create_messaging_draft_v1(
  p_payload jsonb,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft_id uuid := (p_payload ->> 'draftId')::uuid;
  v_version_id uuid := (p_payload ->> 'versionId')::uuid;
  v_organization_id uuid := (p_payload ->> 'organizationId')::uuid;
  v_user_id uuid := (p_payload ->> 'userId')::uuid;
  v_research_snapshot_id uuid := nullif(p_payload ->> 'researchSnapshotId', '')::uuid;
  v_created_at timestamptz := (p_payload ->> 'createdAt')::timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.research_messaging_row_access(v_organization_id, v_user_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not (p_payload ?& array[
      'schemaVersion', 'draftId', 'versionId', 'organizationId', 'userId',
      'researchSnapshotId', 'revision', 'parentVersionId', 'lifecycle',
      'channel', 'recipient', 'content', 'approval', 'preflight', 'createdAt'
    ])
    or p_payload ->> 'schemaVersion' <> '1'
    or (p_payload ->> 'revision')::integer <> 1
    or p_payload -> 'parentVersionId' is distinct from 'null'::jsonb
    or p_payload ->> 'channel' not in ('email', 'linkedin')
    or p_payload ->> 'lifecycle' not in ('draft', 'ready', 'archived')
    or p_content_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid initial MessagingDraftV1 payload' using errcode = '22023';
  end if;

  if v_research_snapshot_id is not null and not exists (
    select 1 from public.research_snapshots rs
    where rs.id = v_research_snapshot_id
      and rs.organization_id = v_organization_id
      and rs.user_id = v_user_id
  ) then
    raise exception 'research snapshot scope mismatch' using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_draft_id::text, 0));

  insert into public.messaging_drafts (
    id, organization_id, user_id, research_snapshot_id, channel, lifecycle,
    current_revision, current_version_id, created_at, updated_at
  ) values (
    v_draft_id, v_organization_id, v_user_id, v_research_snapshot_id,
    p_payload ->> 'channel', p_payload ->> 'lifecycle', 1, null,
    v_created_at, v_created_at
  );

  insert into public.messaging_draft_versions (
    id, draft_id, organization_id, user_id, research_snapshot_id, revision,
    parent_version_id, lifecycle, channel, recipient, content, approval,
    preflight, payload, content_hash, created_at
  ) values (
    v_version_id, v_draft_id, v_organization_id, v_user_id,
    v_research_snapshot_id, 1, null, p_payload ->> 'lifecycle',
    p_payload ->> 'channel', p_payload -> 'recipient', p_payload -> 'content',
    p_payload -> 'approval', p_payload -> 'preflight', p_payload,
    p_content_hash, v_created_at
  );

  update public.messaging_drafts
  set current_version_id = v_version_id
  where id = v_draft_id;

  return p_payload;
end;
$$;

create or replace function public.append_messaging_draft_revision_v1(
  p_draft_id uuid,
  p_expected_parent_version_id uuid,
  p_payload jsonb,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.messaging_drafts%rowtype;
  v_version_id uuid := (p_payload ->> 'versionId')::uuid;
  v_organization_id uuid := (p_payload ->> 'organizationId')::uuid;
  v_user_id uuid := (p_payload ->> 'userId')::uuid;
  v_research_snapshot_id uuid := nullif(p_payload ->> 'researchSnapshotId', '')::uuid;
  v_revision integer := (p_payload ->> 'revision')::integer;
  v_created_at timestamptz := (p_payload ->> 'createdAt')::timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_draft_id::text, 0));

  select * into v_draft
  from public.messaging_drafts
  where id = p_draft_id
  for update;

  if not found then
    raise exception 'messaging draft not found' using errcode = 'P0002';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
    and not public.research_messaging_row_access(v_draft.organization_id, v_draft.user_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_draft.organization_id <> v_organization_id
    or v_draft.user_id <> v_user_id
    or p_payload ->> 'draftId' <> p_draft_id::text then
    raise exception 'messaging draft scope mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.messaging_draft_versions current_version
    where current_version.id = v_draft.current_version_id
      and (
        current_version.recipient -> 'leadRef' is distinct from p_payload #> '{recipient,leadRef}'
        or current_version.recipient -> 'email' is distinct from p_payload #> '{recipient,email}'
        or current_version.recipient -> 'linkedinUrl' is distinct from p_payload #> '{recipient,linkedinUrl}'
      )
  ) then
    raise exception 'messaging draft recipient is immutable' using errcode = '22023';
  end if;

  if v_draft.current_version_id <> p_expected_parent_version_id
    or p_payload ->> 'parentVersionId' is distinct from p_expected_parent_version_id::text
    or v_revision <> v_draft.current_revision + 1 then
    raise exception 'stale messaging draft parent revision' using errcode = '40001';
  end if;

  if not (p_payload ?& array[
      'schemaVersion', 'draftId', 'versionId', 'organizationId', 'userId',
      'researchSnapshotId', 'revision', 'parentVersionId', 'lifecycle',
      'channel', 'recipient', 'content', 'approval', 'preflight', 'createdAt'
    ])
    or p_payload ->> 'schemaVersion' <> '1'
    or p_payload ->> 'lifecycle' <> 'draft'
    or p_payload ->> 'channel' not in ('email', 'linkedin')
    or p_payload #>> '{approval,status}' <> 'pending'
    or p_payload #> '{approval,decidedBy}' <> 'null'::jsonb
    or p_payload #> '{approval,decidedAt}' <> 'null'::jsonb
    or p_payload #> '{approval,reason}' <> 'null'::jsonb
    or p_payload #>> '{preflight,status}' <> 'pending'
    or p_payload #> '{preflight,checkedAt}' <> 'null'::jsonb
    or p_payload #> '{preflight,errors}' <> '[]'::jsonb
    or p_payload #> '{preflight,warnings}' <> '[]'::jsonb
    or p_content_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'child revision must reset lifecycle, approval, and preflight' using errcode = '22023';
  end if;

  if v_research_snapshot_id is not null and not exists (
    select 1 from public.research_snapshots rs
    where rs.id = v_research_snapshot_id
      and rs.organization_id = v_organization_id
      and rs.user_id = v_user_id
  ) then
    raise exception 'research snapshot scope mismatch' using errcode = '23503';
  end if;

  insert into public.messaging_draft_versions (
    id, draft_id, organization_id, user_id, research_snapshot_id, revision,
    parent_version_id, lifecycle, channel, recipient, content, approval,
    preflight, payload, content_hash, created_at
  ) values (
    v_version_id, p_draft_id, v_organization_id, v_user_id,
    v_research_snapshot_id, v_revision, p_expected_parent_version_id,
    'draft', p_payload ->> 'channel', p_payload -> 'recipient',
    p_payload -> 'content', p_payload -> 'approval', p_payload -> 'preflight',
    p_payload, p_content_hash, v_created_at
  );

  update public.messaging_drafts
  set research_snapshot_id = v_research_snapshot_id,
      channel = p_payload ->> 'channel',
      lifecycle = 'draft',
      current_revision = v_revision,
      current_version_id = v_version_id,
      updated_at = v_created_at
  where id = p_draft_id;

  return p_payload;
end;
$$;

revoke all on function public.create_messaging_draft_v1(jsonb, text) from public;
revoke all on function public.append_messaging_draft_revision_v1(uuid, uuid, jsonb, text) from public;
grant execute on function public.create_messaging_draft_v1(jsonb, text) to authenticated, service_role;
grant execute on function public.append_messaging_draft_revision_v1(uuid, uuid, jsonb, text) to authenticated, service_role;

alter table public.research_snapshots enable row level security;
alter table public.messaging_drafts enable row level security;
alter table public.messaging_draft_versions enable row level security;
alter table public.outbound_dispatches enable row level security;
alter table public.outbound_quota_reservations enable row level security;
alter table public.outbound_contact_quota_buckets enable row level security;
alter table public.lead_research_jobs enable row level security;

create policy "Users can view scoped research snapshots"
  on public.research_snapshots for select
  using (
    auth.uid() = user_id
    and (
      organization_id is null
      or exists (
        select 1 from public.organization_members om
        where om.organization_id = research_snapshots.organization_id
          and om.user_id = auth.uid()
      )
    )
  );
create policy "Users can insert scoped research snapshots"
  on public.research_snapshots for insert
  with check (
    auth.uid() = user_id
    and (
      organization_id is null
      or exists (
        select 1 from public.organization_members om
        where om.organization_id = research_snapshots.organization_id
          and om.user_id = auth.uid()
      )
    )
  );

create policy "Users can view scoped messaging drafts"
  on public.messaging_drafts for select
  using (public.research_messaging_row_access(organization_id, user_id));

create policy "Users can view scoped messaging draft versions"
  on public.messaging_draft_versions for select
  using (public.research_messaging_row_access(organization_id, user_id));

create policy "Users can view scoped outbound dispatches"
  on public.outbound_dispatches for select
  using (public.research_messaging_row_access(organization_id, user_id));

create policy "Users can view scoped lead research jobs"
  on public.lead_research_jobs for select
  using (
    auth.uid() = user_id
    and (
      organization_id is null
      or exists (
        select 1 from public.organization_members om
        where om.organization_id = lead_research_jobs.organization_id
          and om.user_id = auth.uid()
      )
    )
  );
create policy "Users can insert scoped lead research jobs"
  on public.lead_research_jobs for insert
  with check (
    auth.uid() = user_id
    and (
      organization_id is null
      or exists (
        select 1 from public.organization_members om
        where om.organization_id = lead_research_jobs.organization_id
          and om.user_id = auth.uid()
      )
    )
  );

notify pgrst, 'reload schema';
