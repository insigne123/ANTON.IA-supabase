-- Cost telemetry for non-draft model calls: report-v2 synthesis phases and the
-- sequence editorial review. Mirrors messaging_draft_generation_attempts so the
-- full cost per investigation (research + drafts + editorial) can be reported
-- with a union. Best-effort only: the application never blocks research or
-- drafting when these inserts fail.
create table public.research_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  research_snapshot_id uuid not null references public.research_snapshots(id) on delete cascade,
  stage text not null check (stage in ('synthesis_analysis', 'synthesis_section', 'synthesis_audit', 'sequence_editorial')),
  attempt_no smallint not null default 1 check (attempt_no between 1 and 10),
  label text,
  model text,
  prompt_version text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  reasoning_tokens integer check (reasoning_tokens is null or reasoning_tokens >= 0),
  passed boolean not null default true,
  created_at timestamptz not null default now()
);

create index research_generation_attempts_scope_idx
  on public.research_generation_attempts(organization_id, created_at desc);
create index research_generation_attempts_stage_idx
  on public.research_generation_attempts(stage, created_at desc);
create index research_generation_attempts_snapshot_idx
  on public.research_generation_attempts(research_snapshot_id, created_at desc);

alter table public.research_generation_attempts enable row level security;

revoke all on table public.research_generation_attempts from public, anon, authenticated;
grant select on table public.research_generation_attempts to authenticated;
grant all on table public.research_generation_attempts to service_role;

create policy "Authenticated members can read research generation attempts"
  on public.research_generation_attempts for select to authenticated
  using (
    organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );
