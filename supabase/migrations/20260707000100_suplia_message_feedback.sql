create table if not exists public.suplia_message_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  message_id uuid not null,
  user_id uuid not null,
  rating text not null check (rating in ('up', 'down')),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create index if not exists idx_suplia_message_feedback_org
  on public.suplia_message_feedback (organization_id, created_at desc);

create index if not exists idx_suplia_message_feedback_message
  on public.suplia_message_feedback (message_id);

alter table public.suplia_message_feedback enable row level security;

-- Feedback is written through server-side API routes with the service role.
-- No direct authenticated/anon policies are exposed intentionally.

notify pgrst, 'reload config';
