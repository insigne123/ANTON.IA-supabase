-- Durable preparation only. Does not create dispatches, approve drafts or send.
create table public.research_sequence_preparations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  research_snapshot_id uuid not null,
  request_key text not null check (length(request_key) = 64),
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  prepared_context jsonb,
  initial_draft_id uuid,
  status text not null default 'queued' check (status in ('queued','running','retry_scheduled','completed','failed','review_required')),
  stage text not null default 'brief' check (stage in ('brief','initial','follow_ups','editorial','done')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 4),
  claim_token uuid,
  heartbeat_at timestamptz,
  next_retry_at timestamptz not null default now(),
  last_error text,
  editorial jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, request_key),
  foreign key (research_snapshot_id, organization_id, user_id)
    references public.research_snapshots(id, organization_id, user_id) on delete cascade,
  foreign key (initial_draft_id, organization_id, user_id)
    references public.messaging_drafts(id, organization_id, user_id) on delete cascade,
  check ((status = 'running') = (claim_token is not null)),
  check (status <> 'running' or heartbeat_at is not null)
);
create index research_sequence_preparations_due_idx
  on public.research_sequence_preparations(next_retry_at)
  where status in ('queued','retry_scheduled','running');
alter table public.research_sequence_preparations enable row level security;
-- All access goes through scoped authenticated routes; no client-side mutation
-- of claims, frozen context or editorial results, even by the owner.
revoke all on public.research_sequence_preparations from public, anon, authenticated;
grant select, insert, update, delete on public.research_sequence_preparations to service_role;
