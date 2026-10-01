-- The memory of a conversation (docs/cowork-conversaciones-largas.md). Each turn sees only the last turns of its history, so in
-- the test of 1 Oct the offer of the first message (background checks) was lost and the emails spoke of «automatización con
-- IA». The coordinator now keeps, with its final decision of each turn, a short structured summary of the whole conversation:
-- the offer in play, who is being looked for, the people of this work and how each one is, the decisions and what is pending.
-- One row per conversation (its first run), replaced by each turn that finishes; the next turn reads it with its history.
-- Like the other staging tables, only the worker (service_role) reads or writes it, and it goes away with its conversation.
-- Forward-only and inert on its own: nothing writes it until the app ships its half.
create table public.cowork_thread_memory (
  root_run_id uuid primary key,
  user_id uuid not null,
  organization_id uuid not null,
  memory jsonb not null check (jsonb_typeof(memory) = 'object' and length(memory::text) <= 12000),
  -- The turn that wrote it last: an older turn finishing late never replaces a newer memory.
  source_run_id uuid not null,
  source_created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  foreign key (root_run_id, user_id, organization_id)
    references public.cowork_runs(id, user_id, organization_id) on delete cascade
);
alter table public.cowork_thread_memory enable row level security;
revoke all on public.cowork_thread_memory from public, anon, authenticated;
grant all on public.cowork_thread_memory to service_role;
