-- Cost and quality telemetry for native draft model calls. Records every model
-- attempt (including preflight failures that never persist a version) so the
-- first-pass rate and token usage per model can be measured. Best-effort only:
-- the application never blocks drafting when this insert fails.
create table public.messaging_draft_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  research_snapshot_id uuid references public.research_snapshots(id) on delete set null,
  draft_id uuid references public.messaging_drafts(id) on delete set null,
  version_id uuid references public.messaging_draft_versions(id) on delete set null,
  origin text not null check (origin in ('create', 'rewrite', 'rewrite_preview')),
  step text not null check (step in ('initial', 'follow_up', 'close')),
  attempt_no smallint not null check (attempt_no between 1 and 5),
  model text,
  prompt_version text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  reasoning_tokens integer check (reasoning_tokens is null or reasoning_tokens >= 0),
  passed boolean not null,
  issue_codes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index messaging_draft_generation_attempts_scope_idx
  on public.messaging_draft_generation_attempts(organization_id, created_at desc);
create index messaging_draft_generation_attempts_model_idx
  on public.messaging_draft_generation_attempts(model, prompt_version, created_at desc);

alter table public.messaging_draft_generation_attempts enable row level security;

revoke all on table public.messaging_draft_generation_attempts from public, anon, authenticated;
grant select on table public.messaging_draft_generation_attempts to authenticated;
grant all on table public.messaging_draft_generation_attempts to service_role;

create policy "Authenticated members can read draft generation attempts"
  on public.messaging_draft_generation_attempts for select to authenticated
  using (
    organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );
