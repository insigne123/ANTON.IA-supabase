-- 20260406120000_create_privacy_requests and 20260406123000_create_privacy_incidents are in production's history, but their
-- schema is not: privacy_requests has no last_action_* columns and privacy_incidents does not exist, so the privacy admin
-- (/api/privacy/requests, /api/privacy/incidents) and the recorded subject actions failed there. Same definitions as those
-- migrations and idempotent, so a database built from this repository keeps them. Only the service role uses these tables.

alter table public.privacy_requests
  add column if not exists last_action_type text,
  add column if not exists last_action_at timestamptz,
  add column if not exists last_action_summary jsonb not null default '{}'::jsonb;

create table if not exists public.privacy_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  severity text not null default 'medium',
  status text not null default 'detected',
  summary text not null,
  affected_scope text,
  data_types text,
  incident_at timestamptz not null default now(),
  detected_at timestamptz not null default now(),
  contained_at timestamptz,
  resolved_at timestamptz,
  reported_by_email text,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint privacy_incidents_severity_check check (severity in ('low', 'medium', 'high')),
  constraint privacy_incidents_status_check check (status in ('detected', 'contained', 'resolved', 'dismissed'))
);

create index if not exists privacy_incidents_status_idx
  on public.privacy_incidents(status, detected_at desc);

create index if not exists privacy_incidents_severity_idx
  on public.privacy_incidents(severity, detected_at desc);

alter table public.privacy_incidents enable row level security;
revoke all on table public.privacy_incidents from anon, authenticated;
