-- «Llamadas y LinkedIn» (propuestas 15 y 19, 19 oct 2026): the touches of a sequence beyond email. One row per contact and
-- rule of the person's cadence («call:3», «linkedin:1»), created when its day comes (src/lib/server/touches.ts), or
-- «manual:<uuid>» when someone schedules one by hand. An answer, a closed conversation or a bounce cancels the open ones.
-- A call can keep the summary of its recording (transcribed and summarized; the audio is never kept).
create table if not exists public.contact_touches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contacted_id text not null references public.contacted_leads(id) on delete cascade,
  rule_key text not null check (rule_key ~ '^(call|linkedin):[0-9]{1,2}$' or rule_key ~ '^manual:[0-9a-f-]{36}$'),
  channel text not null check (channel in ('call', 'linkedin')),
  due_at timestamptz not null,
  state text not null default 'open' check (state in ('open', 'done', 'skipped', 'cancelled')),
  outcome text check (outcome is null or outcome in ('talked', 'voicemail', 'no_answer', 'wrong_number', 'connected', 'messaged', 'not_found')),
  note text check (note is null or length(note) <= 2000),
  reason text check (reason is null or reason in ('replied', 'closed', 'bounced', 'unsubscribed', 'expired', 'skipped')),
  script jsonb check (script is null or jsonb_typeof(script) = 'object'),
  call_summary jsonb check (call_summary is null or jsonb_typeof(call_summary) = 'object'),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contacted_id, rule_key)
);
create index if not exists contact_touches_due_idx on public.contact_touches (organization_id, user_id, state, due_at);

alter table public.contact_touches enable row level security;
revoke all on public.contact_touches from public, anon, authenticated;
grant all on public.contact_touches to service_role;

notify pgrst, 'reload schema';
