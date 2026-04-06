create table if not exists public.user_quota_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_contact_limit integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_quota_overrides_daily_contact_limit_check
    check (daily_contact_limit is null or daily_contact_limit > 0)
);

create index if not exists user_quota_overrides_daily_contact_limit_idx
  on public.user_quota_overrides(daily_contact_limit)
  where daily_contact_limit is not null;

alter table public.user_quota_overrides enable row level security;

drop policy if exists "Users can view their own quota overrides" on public.user_quota_overrides;
create policy "Users can view their own quota overrides"
  on public.user_quota_overrides
  for select
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';
