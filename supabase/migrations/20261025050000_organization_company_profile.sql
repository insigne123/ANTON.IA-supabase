-- APP-06: «Ficha de la empresa». What the company sells lived in three places that never agreed: each person's «Perfil»
-- (profiles.signatures.profile_extended), the offer confirmed in Oportunidades (opportunity_company_context) and an
-- organization setting nobody could edit (antonia_workflow_settings.user_company_profile, empty in production). One row per
-- organization, edited by its owners and admins through the server, with the date it was last reviewed; every member reads it.
-- Forward-only and inert on its own: until a row exists, prospecting, Cowork and Oportunidades read what they read today.

create table public.organization_company_profile (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- The fields of «Tu empresa», «Tu oferta» and «Tu cliente ideal» as «Perfil» names them (company-profile.ts), at most 40 KB.
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object' and octet_length(fields::text) <= 40000),
  -- Grows with every save: a change made in another tab is not overwritten.
  revision integer not null default 1 check (revision > 0),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.organization_company_profile enable row level security;
revoke all on public.organization_company_profile from public, anon, authenticated;
grant select on public.organization_company_profile to authenticated;
grant all on public.organization_company_profile to service_role;
create policy organization_company_profile_read on public.organization_company_profile for select to authenticated
  using (public.is_current_user_organization_member(organization_id));

notify pgrst, 'reload schema';
