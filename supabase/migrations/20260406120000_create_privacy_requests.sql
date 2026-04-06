create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null,
  status text not null default 'submitted',
  request_source text not null default 'public_form',
  requester_name text,
  requester_email text not null,
  requester_company text,
  relation_to_data text,
  target_email text,
  details text not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  reviewed_by_email text,
  last_action_type text,
  last_action_at timestamptz,
  last_action_summary jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint privacy_requests_type_check check (
    request_type in ('access', 'rectification', 'deletion', 'opposition', 'portability', 'blocking', 'other')
  ),
  constraint privacy_requests_status_check check (
    status in ('submitted', 'in_review', 'resolved', 'rejected')
  ),
  constraint privacy_requests_email_check check (position('@' in requester_email) > 1)
);

alter table public.privacy_requests
  add column if not exists reviewed_by_email text,
  add column if not exists last_action_type text,
  add column if not exists last_action_at timestamptz,
  add column if not exists last_action_summary jsonb not null default '{}'::jsonb;

create index if not exists privacy_requests_status_idx
  on public.privacy_requests(status, submitted_at desc);

create index if not exists privacy_requests_requester_email_idx
  on public.privacy_requests(lower(requester_email));

alter table public.privacy_requests enable row level security;
