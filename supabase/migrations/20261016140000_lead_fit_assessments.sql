-- «Probabilidad de calce»: how ideal a person is for the user's offer, estimated by the AI (Haiku) at each stage of the lead —
-- found in a search, saved to «Por escribir», researched (src/lib/lead-fit/core.ts). One row per person and stage for the user
-- who saw it; a change in the person's facts or in «Perfil» (input_hash) replaces it. Written only by the server.

create table if not exists public.lead_fit_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_key text not null,
  stage text not null,
  probability smallint not null,
  summary text not null,
  factors jsonb not null default '[]'::jsonb,
  model text not null,
  input_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_fit_assessments_stage_check check (stage in ('search', 'saved', 'researched')),
  constraint lead_fit_assessments_probability_check check (probability between 0 and 100),
  constraint lead_fit_assessments_key_check check (length(lead_key) between 3 and 400),
  constraint lead_fit_assessments_summary_check check (length(summary) between 1 and 400),
  constraint lead_fit_assessments_factors_check check (jsonb_typeof(factors) = 'array' and jsonb_array_length(factors) <= 6),
  constraint lead_fit_assessments_person_stage_key unique (organization_id, user_id, lead_key, stage)
);

-- The daily cap counts an organization's estimates of the last 24 hours.
create index if not exists lead_fit_assessments_org_updated_idx on public.lead_fit_assessments (organization_id, updated_at desc);

alter table public.lead_fit_assessments enable row level security;
revoke all on table public.lead_fit_assessments from anon, authenticated;
grant select on table public.lead_fit_assessments to authenticated;
grant all on table public.lead_fit_assessments to service_role;

drop policy if exists "Members read their own lead fit" on public.lead_fit_assessments;
create policy "Members read their own lead fit" on public.lead_fit_assessments
  for select to authenticated
  using (user_id = (select auth.uid()) and public.is_current_user_organization_member(organization_id));
