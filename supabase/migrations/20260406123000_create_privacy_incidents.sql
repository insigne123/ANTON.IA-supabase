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
