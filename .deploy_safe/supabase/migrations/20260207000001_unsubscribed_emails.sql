-- Unsubscribed emails table (safe / additive)
create extension if not exists pgcrypto;

create table if not exists public.unsubscribed_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  reason text,
  created_at timestamptz default now(),
  constraint unique_unsubscribe_entry unique nulls not distinct (email, user_id, organization_id)
);

alter table public.unsubscribed_emails enable row level security;

create index if not exists idx_unsubscribed_emails_email on public.unsubscribed_emails(email);
create index if not exists idx_unsubscribed_emails_user_id on public.unsubscribed_emails(user_id);
create index if not exists idx_unsubscribed_emails_org_id on public.unsubscribed_emails(organization_id);

drop policy if exists "Users can view their own unsubscribes" on public.unsubscribed_emails;
create policy "Users can view their own unsubscribes" on public.unsubscribed_emails
  for select using (auth.uid() = user_id);

drop policy if exists "Users can view their org unsubscribes" on public.unsubscribed_emails;
create policy "Users can view their org unsubscribes" on public.unsubscribed_emails
  for select using (
    organization_id is not null and organization_id in (
      select organization_id from public.organization_members where user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert their own unsubscribes" on public.unsubscribed_emails;
create policy "Users can insert their own unsubscribes" on public.unsubscribed_emails
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can insert their org unsubscribes" on public.unsubscribed_emails;
create policy "Users can insert their org unsubscribes" on public.unsubscribed_emails
  for insert with check (
    organization_id is not null and organization_id in (
      select organization_id from public.organization_members where user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete their own unsubscribes" on public.unsubscribed_emails;
create policy "Users can delete their own unsubscribes" on public.unsubscribed_emails
  for delete using (auth.uid() = user_id);

drop policy if exists "Users can delete their org unsubscribes" on public.unsubscribed_emails;
create policy "Users can delete their org unsubscribes" on public.unsubscribed_emails
  for delete using (
    organization_id is not null and organization_id in (
      select organization_id from public.organization_members where user_id = auth.uid() and role in ('admin', 'owner')
    )
  );
