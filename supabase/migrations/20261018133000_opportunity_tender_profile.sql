-- «Ficha para licitaciones»: what the company is and can do when it bids (legal data, size, regions, experience,
-- certifications, guarantees), one per workspace. The AI reads it so it does not discard a tender for something the
-- company has. Written by admins through the server only.
create table public.opportunity_tender_profile (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 32768),
  revision bigint not null default 1 check (revision >= 1),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.opportunity_tender_profile enable row level security;
revoke all on public.opportunity_tender_profile from public, anon, authenticated;
grant all on public.opportunity_tender_profile to service_role;

notify pgrst, 'reload schema';
