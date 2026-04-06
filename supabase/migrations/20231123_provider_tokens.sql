create table if not exists public.provider_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  refresh_token text not null,
  expires_at timestamptz,
  updated_at timestamptz default now(),
  primary key (user_id, provider)
);

alter table public.provider_tokens enable row level security;

create policy "Users can view their own tokens"
  on public.provider_tokens for select
  using (auth.uid() = user_id);

create policy "Users can insert/update their own tokens"
  on public.provider_tokens for all
  using (auth.uid() = user_id);
