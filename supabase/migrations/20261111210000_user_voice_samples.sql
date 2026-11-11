-- «Tu voz» (11 Nov 2026, docs/correos-voz-humana.md): a person's own emails as the samples the app writes their drafts from. Up to five
-- texts the person chose from what they sent with the mailbox they connected, or pasted by hand: the search runs only when they ask for
-- it, and only what they confirm is kept. The samples are the person's alone: `profiles` is readable by the whole organization, so they
-- do not go there. Read and written by the server only, always for the signed-in person (src/lib/server/voice-own-samples.ts).
create table if not exists public.user_voice_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('mailbox', 'manual')),
  provider text check (provider is null or provider in ('gmail', 'outlook')),
  subject text check (subject is null or char_length(subject) <= 200),
  body text not null check (char_length(body) between 40 and 2400),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_voice_samples_user_idx on public.user_voice_samples (user_id, created_at);

alter table public.user_voice_samples enable row level security;
revoke all on table public.user_voice_samples from public, anon, authenticated;
grant select, insert, update, delete on table public.user_voice_samples to service_role;
