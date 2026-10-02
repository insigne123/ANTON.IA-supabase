-- Plan 5, PR-10: the pipeline moves only when a person confirms it. Until now the tracking webhook, the reply sync and
-- SUPL.IA wrote the CRM stage on their own (syncLeadAutopilotToCrm), even backwards: an open after a meeting set the
-- lead back to «Contactado». Each of those events now leaves a suggestion (lead, from, to, reason, source and evidence)
-- that a member accepts one by one or all at once. Only forward moves are suggested, plus a loss from any open stage;
-- a closed lead is never moved by an event, and there is one pending suggestion per lead (the furthest one).
create table if not exists public.crm_stage_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  crm_id text not null,
  from_stage text,
  to_stage text not null,
  reason text not null,
  source text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  constraint crm_stage_suggestions_crm_id_check check (crm_id ~ '^lead_(saved|enriched)\|.+$' and length(crm_id) <= 300),
  constraint crm_stage_suggestions_to_stage_check check (
    to_stage in ('inbox', 'qualified', 'contacted', 'engaged', 'meeting', 'negotiation', 'closed_won', 'closed_lost')
  ),
  constraint crm_stage_suggestions_status_check check (status in ('pending', 'accepted', 'dismissed', 'superseded')),
  constraint crm_stage_suggestions_reason_check check (length(trim(reason)) between 1 and 500),
  constraint crm_stage_suggestions_source_check check (length(trim(source)) between 1 and 80),
  constraint crm_stage_suggestions_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint crm_stage_suggestions_decision_check check ((status = 'pending') = (decided_at is null))
);

create unique index if not exists crm_stage_suggestions_one_pending_idx
  on public.crm_stage_suggestions(organization_id, crm_id) where status = 'pending';
create index if not exists crm_stage_suggestions_org_status_idx
  on public.crm_stage_suggestions(organization_id, status, created_at desc);

alter table public.crm_stage_suggestions enable row level security;
create policy "Members can read stage suggestions"
  on public.crm_stage_suggestions for select to authenticated
  using (public.organization_has_role_v1(organization_id));

revoke all on table public.crm_stage_suggestions from public, anon, authenticated;
grant select on table public.crm_stage_suggestions to authenticated;
grant all on table public.crm_stage_suggestions to service_role;

notify pgrst, 'reload schema';
