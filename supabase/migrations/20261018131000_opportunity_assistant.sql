-- The general conversation of Oportunidades: a person's threads about the whole section (new tenders, closings, what is
-- asked, future demand), apart from the chat inside each opportunity. Private to the person who writes, like that chat,
-- and read and written only through the server.
create table public.opportunity_assistant_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index opportunity_assistant_threads_recent_idx on public.opportunity_assistant_threads (organization_id, user_id, updated_at desc);

create table public.opportunity_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null references public.opportunity_assistant_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  question text not null check (length(question) between 1 and 2000),
  answer jsonb check (answer is null or pg_column_size(answer) <= 65536),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, request_id)
);
create index opportunity_assistant_messages_thread_idx on public.opportunity_assistant_messages (thread_id, created_at);

alter table public.opportunity_assistant_threads enable row level security;
alter table public.opportunity_assistant_messages enable row level security;
revoke all on public.opportunity_assistant_threads, public.opportunity_assistant_messages from public, anon, authenticated;
grant all on public.opportunity_assistant_threads, public.opportunity_assistant_messages to service_role;

notify pgrst, 'reload schema';
