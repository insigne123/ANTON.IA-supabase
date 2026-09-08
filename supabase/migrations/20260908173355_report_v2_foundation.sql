-- Additive report versioning and a durable synthesis lifecycle.

alter table public.research_report_documents
  drop constraint if exists research_report_documents_research_snapshot_id_key;

alter table public.research_report_documents
  add column if not exists delivery_state text not null default 'visible',
  add column if not exists revision integer,
  add column if not exists synthesis_context_hash text;

update public.research_report_documents
set revision = case
  when document ->> 'revision' ~ '^[1-9][0-9]*$' then (document ->> 'revision')::integer
  else 1
end
where revision is null;

alter table public.research_report_documents
  alter column revision set not null;

create or replace function public.report_v2_migration_canonical_jsonb(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  result text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(
        '{' || string_agg(
          to_jsonb(entry.key)::text || ':' || public.report_v2_migration_canonical_jsonb(entry.value),
          ',' order by entry.key
        ) || '}',
        '{}'
      )
      into result
      from jsonb_each(p_value) entry;
    when 'array' then
      select coalesce(
        '[' || string_agg(
          public.report_v2_migration_canonical_jsonb(item.value),
          ',' order by item.ordinality
        ) || ']',
        '[]'
      )
      into result
      from jsonb_array_elements(p_value) with ordinality as item(value, ordinality);
    else
      result := p_value::text;
  end case;
  return result;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.research_report_documents report
    where encode(
      extensions.digest(
        convert_to(public.report_v2_migration_canonical_jsonb(report.document), 'UTF8'),
        'sha256'
      ),
      'hex'
    ) <> report.content_hash
  ) then
    raise exception 'RESEARCH_REPORT_EXISTING_CONTENT_HASH_INVALID';
  end if;
end;
$$;

with repaired as (
  select
    report.id,
    report.document || jsonb_build_object(
      'schemaVersion', report.schema_version,
      'revision', report.revision,
      'researchSnapshotId', report.research_snapshot_id::text,
      'scope', coalesce(report.document -> 'scope', '{}'::jsonb) || jsonb_build_object(
        'organizationId', report.organization_id::text,
        'ownerUserId', report.user_id::text
      )
    ) as document
  from public.research_report_documents report
  where report.document ->> 'schemaVersion' is distinct from report.schema_version
    or report.document ->> 'revision' is distinct from report.revision::text
    or report.document ->> 'researchSnapshotId' is distinct from report.research_snapshot_id::text
    or report.document #>> '{scope,organizationId}' is distinct from report.organization_id::text
    or report.document #>> '{scope,ownerUserId}' is distinct from report.user_id::text
)
update public.research_report_documents report
set
  document = repaired.document,
  content_hash = encode(
    extensions.digest(
      convert_to(public.report_v2_migration_canonical_jsonb(repaired.document), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
from repaired
where report.id = repaired.id;

drop function public.report_v2_migration_canonical_jsonb(jsonb);

alter table public.messaging_draft_generation_metadata
  add column if not exists report_document_id uuid,
  add column if not exists report_schema_version text,
  add column if not exists report_revision integer,
  add column if not exists report_content_hash text;

revoke all on table public.messaging_draft_generation_metadata from public, anon, authenticated;
grant select on table public.messaging_draft_generation_metadata to authenticated;
grant all on table public.messaging_draft_generation_metadata to service_role;

with historical_report as (
  select distinct on (research_snapshot_id, organization_id, user_id)
    id,
    research_snapshot_id,
    organization_id,
    user_id,
    schema_version,
    revision,
    content_hash
  from public.research_report_documents
  where schema_version = 'research-report-document/v1'
  order by research_snapshot_id, organization_id, user_id, generated_at desc, created_at desc
)
update public.messaging_draft_generation_metadata metadata
set
  report_document_id = report.id,
  report_schema_version = report.schema_version,
  report_revision = report.revision,
  report_content_hash = report.content_hash
from historical_report report
where metadata.report_document_id is null
  and metadata.research_snapshot_id = report.research_snapshot_id
  and metadata.organization_id = report.organization_id
  and metadata.user_id = report.user_id;

alter table public.messaging_draft_generation_metadata
  drop constraint if exists messaging_draft_generation_metadata_report_provenance_check;

alter table public.messaging_draft_generation_metadata
  drop constraint if exists messaging_draft_generation_metadata_report_scope_fk;

alter table public.messaging_draft_generation_metadata
  add constraint messaging_draft_generation_metadata_report_provenance_check check (
    (report_document_id is null and report_schema_version is null and report_revision is null and report_content_hash is null)
    or (
      report_document_id is not null
      and research_snapshot_id is not null
      and report_schema_version is not null
      and report_schema_version in ('research-report-document/v1', 'research-report-document/v2')
      and report_revision is not null
      and report_revision >= 1
      and report_content_hash is not null
      and report_content_hash ~ '^[a-f0-9]{64}$'
    )
  );

alter table public.research_report_documents
  drop constraint if exists research_report_documents_delivery_state_check;

alter table public.research_report_documents
  add constraint research_report_documents_delivery_state_check
  check (delivery_state in ('visible', 'suppressed'));

alter table public.research_report_documents
  drop constraint if exists research_report_documents_schema_check;

alter table public.research_report_documents
  add constraint research_report_documents_schema_check
  check (schema_version in ('research-report-document/v1', 'research-report-document/v2'));

create index if not exists research_report_documents_snapshot_schema_generated_idx
  on public.research_report_documents(research_snapshot_id, schema_version, generated_at desc, created_at desc);

create unique index if not exists research_report_documents_v2_revision_key
  on public.research_report_documents(research_snapshot_id, schema_version, revision)
  where schema_version = 'research-report-document/v2';

alter table public.research_report_documents
  add constraint research_report_documents_revision_check
  check (revision >= 1),
  add constraint research_report_documents_context_hash_check
  check (synthesis_context_hash is null or synthesis_context_hash ~ '^[a-f0-9]{64}$'),
  add constraint research_report_documents_provenance_key
  unique (id, organization_id, user_id, research_snapshot_id, schema_version, revision, content_hash);

alter table public.messaging_draft_generation_metadata
  add constraint messaging_draft_generation_metadata_report_scope_fk
  foreign key (
    report_document_id,
    organization_id,
    user_id,
    research_snapshot_id,
    report_schema_version,
    report_revision,
    report_content_hash
  ) references public.research_report_documents(
    id,
    organization_id,
    user_id,
    research_snapshot_id,
    schema_version,
    revision,
    content_hash
  ) on delete restrict;

alter table public.research_report_documents
  drop constraint if exists research_report_documents_json_scope_check;

alter table public.research_report_documents
  add constraint research_report_documents_json_scope_check check (
    jsonb_typeof(document) = 'object'
    and document ->> 'schemaVersion' is not null
    and document ->> 'schemaVersion' = schema_version
    and document ->> 'revision' is not null
    and document ->> 'revision' = revision::text
    and document ->> 'researchSnapshotId' is not null
    and document ->> 'researchSnapshotId' = research_snapshot_id::text
    and document #>> '{scope,organizationId}' is not null
    and document #>> '{scope,organizationId}' = organization_id::text
    and document #>> '{scope,ownerUserId}' is not null
    and document #>> '{scope,ownerUserId}' = user_id::text
  );

create or replace function public.protect_research_report_document_immutability_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.research_snapshot_id is distinct from old.research_snapshot_id
    or new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id
    or new.status is distinct from old.status
    or new.generation_method is distinct from old.generation_method
    or new.provider is distinct from old.provider
    or new.model is distinct from old.model
    or new.prompt_version is distinct from old.prompt_version
    or new.schema_version is distinct from old.schema_version
    or new.revision is distinct from old.revision
    or new.synthesis_context_hash is distinct from old.synthesis_context_hash
    or new.document is distinct from old.document
    or new.content_hash is distinct from old.content_hash
    or new.retryable is distinct from old.retryable
    or new.error_code is distinct from old.error_code
    or new.error_message is distinct from old.error_message
    or new.generated_at is distinct from old.generated_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'RESEARCH_REPORT_DOCUMENT_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_research_report_document_immutability_v1
  on public.research_report_documents;
create trigger protect_research_report_document_immutability_v1
  before update on public.research_report_documents
  for each row execute function public.protect_research_report_document_immutability_v1();

create index if not exists research_report_documents_visible_scope_idx
  on public.research_report_documents(organization_id, user_id, generated_at desc)
  where delivery_state = 'visible';

drop policy if exists "Users can view scoped research report documents"
  on public.research_report_documents;

create policy "Users can view scoped research report documents"
  on public.research_report_documents for select to authenticated
  using (
    delivery_state = 'visible'
    and user_id = (select auth.uid())
    and organization_id in (
      select om.organization_id
      from public.organization_members om
      where om.user_id = (select auth.uid())
    )
  );

create table if not exists public.research_report_synthesis_states (
  id uuid primary key default gen_random_uuid(),
  research_snapshot_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version text not null,
  status text not null default 'queued',
  prompt_version text not null,
  seller_profile_hash text not null,
  attempt_count integer not null default 0,
  retryable boolean not null default true,
  error_code text,
  error_message text,
  claim_token uuid,
  claimed_at timestamptz,
  next_retry_at timestamptz not null default now(),
  report_document_id uuid references public.research_report_documents(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_report_synthesis_states_snapshot_scope_fk
    foreign key (research_snapshot_id, organization_id, user_id)
    references public.research_snapshots(id, organization_id, user_id) on delete cascade,
  constraint research_report_synthesis_states_schema_check
    check (schema_version in ('research-report-document/v1', 'research-report-document/v2')),
  constraint research_report_synthesis_states_status_check
    check (status in ('queued', 'running', 'retry_scheduled', 'completed', 'partial', 'failed_permanent')),
  constraint research_report_synthesis_states_prompt_check
    check (length(trim(prompt_version)) between 1 and 160),
  constraint research_report_synthesis_states_profile_hash_check
    check (seller_profile_hash ~ '^[a-f0-9]{64}$'),
  constraint research_report_synthesis_states_attempt_check
    check (attempt_count between 0 and 4),
  constraint research_report_synthesis_states_claim_check
    check ((status = 'running') = (claim_token is not null and claimed_at is not null)),
  unique (research_snapshot_id, schema_version),
  unique (id, organization_id, user_id)
);

create or replace function public.validate_research_report_synthesis_document_scope_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.report_document_id is not null and not exists (
    select 1
    from public.research_report_documents report
    where report.id = new.report_document_id
      and report.research_snapshot_id = new.research_snapshot_id
      and report.organization_id = new.organization_id
      and report.user_id = new.user_id
      and report.schema_version = new.schema_version
  ) then
    raise exception 'RESEARCH_REPORT_SYNTHESIS_DOCUMENT_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_research_report_synthesis_document_scope_v1
  on public.research_report_synthesis_states;
create trigger validate_research_report_synthesis_document_scope_v1
  before insert or update of report_document_id, research_snapshot_id, organization_id, user_id, schema_version
  on public.research_report_synthesis_states
  for each row execute function public.validate_research_report_synthesis_document_scope_v1();

revoke all on function public.validate_research_report_synthesis_document_scope_v1() from public, anon, authenticated;

with current_report as (
  select distinct on (research_snapshot_id, schema_version)
    report.*
  from public.research_report_documents report
  where report.generation_method = 'model'
  order by research_snapshot_id, schema_version, generated_at desc, created_at desc
)
insert into public.research_report_synthesis_states (
  research_snapshot_id,
  organization_id,
  user_id,
  schema_version,
  status,
  prompt_version,
  seller_profile_hash,
  attempt_count,
  retryable,
  error_code,
  error_message,
  next_retry_at,
  report_document_id,
  completed_at,
  created_at,
  updated_at
)
select
  report.research_snapshot_id,
  report.organization_id,
  report.user_id,
  report.schema_version,
  report.status,
  report.prompt_version,
  case
    when report.document #>> '{synthesis,sellerProfileHash}' ~ '^[a-f0-9]{64}$'
      then report.document #>> '{synthesis,sellerProfileHash}'
    else repeat('0', 64)
  end,
  1,
  report.retryable,
  report.error_code,
  report.error_message,
  case when report.retryable then now() else report.generated_at end,
  report.id,
  case when report.retryable then null else report.generated_at end,
  report.created_at,
  now()
from current_report report
on conflict (research_snapshot_id, schema_version) do nothing;

create index if not exists research_report_synthesis_states_due_idx
  on public.research_report_synthesis_states(next_retry_at, created_at)
  where status in ('queued', 'retry_scheduled', 'partial');

create index if not exists research_report_synthesis_states_stale_claim_idx
  on public.research_report_synthesis_states(claimed_at)
  where status = 'running';

create index if not exists research_report_synthesis_states_scope_idx
  on public.research_report_synthesis_states(organization_id, user_id, updated_at desc);

alter table public.research_report_synthesis_states enable row level security;

revoke all on table public.research_report_synthesis_states from public, anon, authenticated;
grant select on table public.research_report_synthesis_states to authenticated;
grant all on table public.research_report_synthesis_states to service_role;

create policy "Users can view scoped research report synthesis states"
  on public.research_report_synthesis_states for select to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (
      select om.organization_id
      from public.organization_members om
      where om.user_id = (select auth.uid())
    )
  );

create or replace function public.enqueue_research_report_synthesis_v1(
  p_research_snapshot_id uuid,
  p_schema_version text,
  p_prompt_version text,
  p_seller_profile_hash text,
  p_now timestamptz default now()
)
returns setof public.research_report_synthesis_states
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.research_report_synthesis_states as synthesis (
    research_snapshot_id,
    organization_id,
    user_id,
    schema_version,
    status,
    prompt_version,
    seller_profile_hash,
    next_retry_at,
    updated_at
  )
  select
    snapshot.id,
    snapshot.organization_id,
    snapshot.user_id,
    p_schema_version,
    'queued',
    p_prompt_version,
    p_seller_profile_hash,
    p_now,
    p_now
  from public.research_snapshots snapshot
  where snapshot.id = p_research_snapshot_id
  on conflict (research_snapshot_id, schema_version) do update
  set
    status = case
      when synthesis.prompt_version <> excluded.prompt_version
        or synthesis.seller_profile_hash <> excluded.seller_profile_hash
        or (synthesis.status in ('completed', 'partial') and synthesis.report_document_id is null)
      then 'queued'
      else synthesis.status
    end,
    prompt_version = excluded.prompt_version,
    seller_profile_hash = excluded.seller_profile_hash,
    attempt_count = case
      when synthesis.prompt_version <> excluded.prompt_version
        or synthesis.seller_profile_hash <> excluded.seller_profile_hash
        or (synthesis.status in ('completed', 'partial') and synthesis.report_document_id is null)
      then 0
      else synthesis.attempt_count
    end,
    retryable = case
      when synthesis.prompt_version <> excluded.prompt_version
        or synthesis.seller_profile_hash <> excluded.seller_profile_hash
        or (synthesis.status in ('completed', 'partial') and synthesis.report_document_id is null)
      then true
      else synthesis.retryable
    end,
    error_code = case
      when synthesis.prompt_version <> excluded.prompt_version
        or synthesis.seller_profile_hash <> excluded.seller_profile_hash
        or (synthesis.status in ('completed', 'partial') and synthesis.report_document_id is null)
      then null
      else synthesis.error_code
    end,
    error_message = case
      when synthesis.prompt_version <> excluded.prompt_version
        or synthesis.seller_profile_hash <> excluded.seller_profile_hash
        or (synthesis.status in ('completed', 'partial') and synthesis.report_document_id is null)
      then null
      else synthesis.error_message
    end,
    claim_token = case
      when synthesis.prompt_version <> excluded.prompt_version
        or synthesis.seller_profile_hash <> excluded.seller_profile_hash
        or (synthesis.status in ('completed', 'partial') and synthesis.report_document_id is null)
      then null
      else synthesis.claim_token
    end,
    claimed_at = case
      when synthesis.prompt_version <> excluded.prompt_version
        or synthesis.seller_profile_hash <> excluded.seller_profile_hash
        or (synthesis.status in ('completed', 'partial') and synthesis.report_document_id is null)
      then null
      else synthesis.claimed_at
    end,
    report_document_id = case
      when synthesis.prompt_version <> excluded.prompt_version
        or synthesis.seller_profile_hash <> excluded.seller_profile_hash
        or (synthesis.status in ('completed', 'partial') and synthesis.report_document_id is null)
      then null
      else synthesis.report_document_id
    end,
    completed_at = case
      when synthesis.prompt_version <> excluded.prompt_version
        or synthesis.seller_profile_hash <> excluded.seller_profile_hash
        or (synthesis.status in ('completed', 'partial') and synthesis.report_document_id is null)
      then null
      else synthesis.completed_at
    end,
    next_retry_at = case
      when synthesis.prompt_version <> excluded.prompt_version
        or synthesis.seller_profile_hash <> excluded.seller_profile_hash
        or (synthesis.status in ('completed', 'partial') and synthesis.report_document_id is null)
      then p_now
      else synthesis.next_retry_at
    end,
    updated_at = p_now
  where synthesis.status <> 'running'
    or synthesis.claimed_at < p_now - interval '15 minutes'
  returning synthesis.*;
$$;

create or replace function public.claim_research_report_synthesis_v1(
  p_research_snapshot_id uuid,
  p_schema_version text,
  p_prompt_version text,
  p_seller_profile_hash text,
  p_claim_token uuid,
  p_now timestamptz default now()
)
returns setof public.research_report_synthesis_states
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform * from public.enqueue_research_report_synthesis_v1(
    p_research_snapshot_id,
    p_schema_version,
    p_prompt_version,
    p_seller_profile_hash,
    p_now
  );

  return query
  update public.research_report_synthesis_states synthesis
  set
    status = 'running',
    attempt_count = synthesis.attempt_count + 1,
    claim_token = p_claim_token,
    claimed_at = p_now,
    updated_at = p_now
  where synthesis.research_snapshot_id = p_research_snapshot_id
    and synthesis.schema_version = p_schema_version
    and synthesis.prompt_version = p_prompt_version
    and synthesis.seller_profile_hash = p_seller_profile_hash
    and (
      (
        synthesis.attempt_count < 4
        and synthesis.retryable
        and synthesis.status in ('queued', 'retry_scheduled', 'partial')
        and synthesis.next_retry_at <= p_now
      )
      or (
        synthesis.status = 'running'
        and synthesis.attempt_count between 1 and 3
        and synthesis.claimed_at < p_now - interval '15 minutes'
      )
    )
  returning synthesis.*;
end;
$$;

create or replace function public.complete_research_report_synthesis_v1(
  p_state_id uuid,
  p_claim_token uuid,
  p_status text,
  p_report_document_id uuid,
  p_retryable boolean default false,
  p_now timestamptz default now()
)
returns setof public.research_report_synthesis_states
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.research_report_synthesis_states synthesis
  set
    status = p_status,
    retryable = p_status = 'partial' and p_retryable and synthesis.attempt_count < 4,
    error_code = null,
    error_message = null,
    claim_token = null,
    claimed_at = null,
    next_retry_at = case
      when p_status = 'partial' and p_retryable and synthesis.attempt_count < 4 then
        case synthesis.attempt_count
          when 1 then p_now + interval '1 minute'
          when 2 then p_now + interval '5 minutes'
          else p_now + interval '30 minutes'
        end
      else p_now
    end,
    report_document_id = p_report_document_id,
    completed_at = case
      when p_status = 'partial' and p_retryable and synthesis.attempt_count < 4 then null
      else p_now
    end,
    updated_at = p_now
  where synthesis.id = p_state_id
    and synthesis.claim_token = p_claim_token
    and synthesis.status = 'running'
    and p_status in ('completed', 'partial')
    and exists (
      select 1
      from public.research_report_documents document
      where document.id = p_report_document_id
        and document.research_snapshot_id = synthesis.research_snapshot_id
        and document.organization_id = synthesis.organization_id
        and document.user_id = synthesis.user_id
        and document.schema_version = synthesis.schema_version
        and document.status = p_status
        and document.prompt_version = synthesis.prompt_version
        and (
          document.synthesis_context_hash = synthesis.seller_profile_hash
          or (
            document.synthesis_context_hash is null
            and document.schema_version = 'research-report-document/v1'
            and document.document #>> '{synthesis,sellerProfileHash}' = synthesis.seller_profile_hash
          )
        )
    )
  returning synthesis.*;
$$;

create or replace function public.persist_research_report_synthesis_result_v1(
  p_state_id uuid,
  p_claim_token uuid,
  p_status text,
  p_generation_method text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_schema_version text,
  p_delivery_state text,
  p_document jsonb,
  p_content_hash text,
  p_retryable boolean,
  p_error_code text,
  p_error_message text,
  p_generated_at timestamptz,
  p_now timestamptz default now()
)
returns table(report_document jsonb, synthesis_state jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  state_row public.research_report_synthesis_states%rowtype;
  document_row public.research_report_documents%rowtype;
  document_revision integer;
begin
  if p_status not in ('completed', 'partial')
    or p_generation_method <> 'model'
    or p_provider <> 'openai'
    or p_schema_version not in ('research-report-document/v1', 'research-report-document/v2')
    or p_delivery_state not in ('visible', 'suppressed')
    or p_content_hash is null
    or p_content_hash !~ '^[a-f0-9]{64}$'
    or p_document is null
    or p_document ->> 'revision' is null
    or p_document ->> 'revision' !~ '^[1-9][0-9]*$'
  then
    raise exception 'RESEARCH_REPORT_SYNTHESIS_RESULT_INVALID';
  end if;

  document_revision := (p_document ->> 'revision')::integer;

  select *
  into state_row
  from public.research_report_synthesis_states synthesis
  where synthesis.id = p_state_id
    and synthesis.claim_token = p_claim_token
    and synthesis.status = 'running'
  for update;

  if not found then
    select *
    into state_row
    from public.research_report_synthesis_states synthesis
    where synthesis.id = p_state_id
      and synthesis.status in ('completed', 'partial');
    if found then
      select *
      into document_row
      from public.research_report_documents stored
      where stored.id = state_row.report_document_id
        and stored.status = p_status
        and stored.generation_method = p_generation_method
        and stored.provider = p_provider
        and stored.prompt_version = p_prompt_version
        and stored.schema_version = p_schema_version
        and stored.delivery_state = p_delivery_state
        and stored.revision = document_revision
        and stored.content_hash = p_content_hash;
      if found then
        return query select to_jsonb(document_row), to_jsonb(state_row);
      end if;
    end if;
    return;
  end if;

  if state_row.prompt_version <> p_prompt_version
    or state_row.schema_version <> p_schema_version
    or p_document ->> 'schemaVersion' is null
    or p_document ->> 'schemaVersion' <> state_row.schema_version
    or p_document ->> 'researchSnapshotId' is null
    or p_document ->> 'researchSnapshotId' <> state_row.research_snapshot_id::text
    or p_document #>> '{scope,organizationId}' is null
    or p_document #>> '{scope,organizationId}' <> state_row.organization_id::text
    or p_document #>> '{scope,ownerUserId}' is null
    or p_document #>> '{scope,ownerUserId}' <> state_row.user_id::text
  then
    raise exception 'RESEARCH_REPORT_SYNTHESIS_RESULT_SCOPE_MISMATCH';
  end if;

  insert into public.research_report_documents (
    research_snapshot_id,
    organization_id,
    user_id,
    status,
    generation_method,
    provider,
    model,
    prompt_version,
    schema_version,
    delivery_state,
    revision,
    synthesis_context_hash,
    document,
    content_hash,
    retryable,
    error_code,
    error_message,
    generated_at,
    created_at,
    updated_at
  ) values (
    state_row.research_snapshot_id,
    state_row.organization_id,
    state_row.user_id,
    p_status,
    p_generation_method,
    p_provider,
    nullif(trim(p_model), ''),
    p_prompt_version,
    p_schema_version,
    p_delivery_state,
    document_revision,
    state_row.seller_profile_hash,
    p_document,
    p_content_hash,
    p_status = 'partial' and p_retryable and state_row.attempt_count < 4,
    case when p_status = 'partial' then nullif(trim(p_error_code), '') else null end,
    case when p_status = 'partial' then left(nullif(trim(p_error_message), ''), 1000) else null end,
    p_generated_at,
    p_now,
    p_now
  )
  returning * into document_row;

  update public.research_report_synthesis_states synthesis
  set
    status = p_status,
    retryable = p_status = 'partial' and p_retryable and synthesis.attempt_count < 4,
    error_code = null,
    error_message = null,
    claim_token = null,
    claimed_at = null,
    next_retry_at = case
      when p_status = 'partial' and p_retryable and synthesis.attempt_count < 4 then
        case synthesis.attempt_count
          when 1 then p_now + interval '1 minute'
          when 2 then p_now + interval '5 minutes'
          else p_now + interval '30 minutes'
        end
      else p_now
    end,
    report_document_id = document_row.id,
    completed_at = case
      when p_status = 'partial' and p_retryable and synthesis.attempt_count < 4 then null
      else p_now
    end,
    updated_at = p_now
  where synthesis.id = state_row.id
    and synthesis.claim_token = p_claim_token
    and synthesis.status = 'running'
  returning synthesis.* into state_row;

  return query select to_jsonb(document_row), to_jsonb(state_row);
  return;
end;
$$;

create or replace function public.fail_research_report_synthesis_v1(
  p_state_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default true,
  p_now timestamptz default now()
)
returns setof public.research_report_synthesis_states
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.research_report_synthesis_states synthesis
  set
    status = case when not p_retryable or synthesis.attempt_count >= 4 then 'failed_permanent' else 'retry_scheduled' end,
    retryable = p_retryable and synthesis.attempt_count < 4,
    error_code = p_error_code,
    error_message = left(p_error_message, 1000),
    claim_token = null,
    claimed_at = null,
    next_retry_at = case
      when not p_retryable or synthesis.attempt_count >= 4 then p_now
      else case synthesis.attempt_count
        when 1 then p_now + interval '1 minute'
        when 2 then p_now + interval '5 minutes'
        else p_now + interval '30 minutes'
      end
    end,
    completed_at = case when not p_retryable or synthesis.attempt_count >= 4 then p_now else null end,
    updated_at = p_now
  where synthesis.id = p_state_id
    and synthesis.claim_token = p_claim_token
    and synthesis.status = 'running'
  returning synthesis.*;
$$;

create or replace function public.reject_research_report_synthesis_candidate_v1(
  p_state_id uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default true,
  p_now timestamptz default now()
)
returns setof public.research_report_synthesis_states
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  state_row public.research_report_synthesis_states%rowtype;
  next_attempt integer;
begin
  select *
  into state_row
  from public.research_report_synthesis_states synthesis
  where synthesis.id = p_state_id
    and (
      (
        synthesis.status in ('queued', 'retry_scheduled', 'partial')
        and synthesis.retryable
        and synthesis.next_retry_at <= p_now
      )
      or (
        synthesis.status = 'running'
        and synthesis.claimed_at < p_now - interval '15 minutes'
      )
    )
  for update;

  if not found then
    return;
  end if;

  next_attempt := least(4, state_row.attempt_count + 1);

  return query
  update public.research_report_synthesis_states synthesis
  set
    status = case when not p_retryable or next_attempt >= 4 then 'failed_permanent' else 'retry_scheduled' end,
    attempt_count = next_attempt,
    retryable = p_retryable and next_attempt < 4,
    error_code = left(nullif(trim(p_error_code), ''), 150),
    error_message = left(nullif(trim(p_error_message), ''), 1000),
    claim_token = null,
    claimed_at = null,
    next_retry_at = case
      when not p_retryable or next_attempt >= 4 then p_now
      else case next_attempt
        when 1 then p_now + interval '1 minute'
        when 2 then p_now + interval '5 minutes'
        else p_now + interval '30 minutes'
      end
    end,
    completed_at = case when not p_retryable or next_attempt >= 4 then p_now else null end,
    updated_at = p_now
  where synthesis.id = state_row.id
  returning synthesis.*;
end;
$$;

revoke all on function public.enqueue_research_report_synthesis_v1(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_research_report_synthesis_v1(uuid, text, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_research_report_synthesis_v1(uuid, uuid, text, uuid, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.persist_research_report_synthesis_result_v1(uuid, uuid, text, text, text, text, text, text, text, jsonb, text, boolean, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_research_report_synthesis_v1(uuid, uuid, text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.reject_research_report_synthesis_candidate_v1(uuid, text, text, boolean, timestamptz) from public, anon, authenticated;

grant execute on function public.enqueue_research_report_synthesis_v1(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.claim_research_report_synthesis_v1(uuid, text, text, text, uuid, timestamptz) to service_role;
grant execute on function public.complete_research_report_synthesis_v1(uuid, uuid, text, uuid, boolean, timestamptz) to service_role;
grant execute on function public.persist_research_report_synthesis_result_v1(uuid, uuid, text, text, text, text, text, text, text, jsonb, text, boolean, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.fail_research_report_synthesis_v1(uuid, uuid, text, text, boolean, timestamptz) to service_role;
grant execute on function public.reject_research_report_synthesis_candidate_v1(uuid, text, text, boolean, timestamptz) to service_role;

create or replace function public.create_native_messaging_draft_v1(
  p_payload jsonb,
  p_content_hash text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  draft_id uuid := (p_payload ->> 'draftId')::uuid;
  version_id uuid := (p_payload ->> 'versionId')::uuid;
  organization_id uuid := (p_payload ->> 'organizationId')::uuid;
  user_id uuid := (p_payload ->> 'userId')::uuid;
  research_snapshot_id uuid := nullif(p_payload ->> 'researchSnapshotId', '')::uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_metadata is null
    or jsonb_typeof(p_metadata) <> 'object'
    or research_snapshot_id is null
    or p_metadata ->> 'versionId' is distinct from version_id::text
    or p_metadata ->> 'draftId' is distinct from draft_id::text
    or p_metadata ->> 'organizationId' is distinct from organization_id::text
    or p_metadata ->> 'userId' is distinct from user_id::text
    or p_metadata ->> 'researchSnapshotId' is distinct from research_snapshot_id::text
    or jsonb_typeof(p_metadata -> 'claimIds') is distinct from 'array'
  then
    raise exception 'NATIVE_DRAFT_METADATA_SCOPE_MISMATCH' using errcode = '22023';
  end if;

  perform public.create_messaging_draft_v1(p_payload, p_content_hash);

  insert into public.messaging_draft_generation_metadata (
    version_id,
    draft_id,
    organization_id,
    user_id,
    research_snapshot_id,
    generation_method,
    provider,
    model,
    prompt_version,
    style_profile_id,
    claim_ids,
    report_document_id,
    report_schema_version,
    report_revision,
    report_content_hash
  ) values (
    version_id,
    draft_id,
    organization_id,
    user_id,
    research_snapshot_id,
    p_metadata ->> 'generationMethod',
    nullif(p_metadata ->> 'provider', ''),
    nullif(p_metadata ->> 'model', ''),
    p_metadata ->> 'promptVersion',
    nullif(p_metadata ->> 'styleProfileId', '')::uuid,
    p_metadata -> 'claimIds',
    nullif(p_metadata ->> 'reportDocumentId', '')::uuid,
    nullif(p_metadata ->> 'reportSchemaVersion', ''),
    nullif(p_metadata ->> 'reportRevision', '')::integer,
    nullif(p_metadata ->> 'reportContentHash', '')
  );

  return p_payload;
end;
$$;

revoke all on function public.create_native_messaging_draft_v1(jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_native_messaging_draft_v1(jsonb, text, jsonb) to service_role;

create or replace function public.clone_messaging_draft_generation_metadata_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_version_id is null then
    return new;
  end if;

  insert into public.messaging_draft_generation_metadata (
    version_id,
    draft_id,
    organization_id,
    user_id,
    research_snapshot_id,
    generation_method,
    provider,
    model,
    prompt_version,
    style_profile_id,
    claim_ids,
    report_document_id,
    report_schema_version,
    report_revision,
    report_content_hash
  )
  select
    new.id,
    new.draft_id,
    new.organization_id,
    new.user_id,
    metadata.research_snapshot_id,
    metadata.generation_method,
    metadata.provider,
    metadata.model,
    metadata.prompt_version,
    metadata.style_profile_id,
    metadata.claim_ids,
    metadata.report_document_id,
    metadata.report_schema_version,
    metadata.report_revision,
    metadata.report_content_hash
  from public.messaging_draft_generation_metadata metadata
  where metadata.version_id = new.parent_version_id
    and metadata.draft_id = new.draft_id
    and metadata.organization_id = new.organization_id
    and metadata.user_id = new.user_id
  on conflict (version_id) do nothing;

  return new;
end;
$$;

revoke all on function public.clone_messaging_draft_generation_metadata_v1() from public, anon, authenticated;

notify pgrst, 'reload schema';
