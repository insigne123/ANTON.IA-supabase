-- «Contacto del día» by person (15 Nov 2026, docs/contacto-del-dia.md): until now what a person gets was their team's plan
-- (organizations.lead_drop_size and lead_drop_weekdays, 20261112200000_organizations_lead_drop_plan.sql). A team may now have
-- some people with a plan of their own, for example six contacts for the ones who come in but use the app little, while the
-- rest keep the team's. A row here is that person's plan in that workspace:
--   lead_drop_size      how many contacts they get, 1 to 10;
--   lead_drop_weekdays  their days, 1 (Monday) to 5 (Friday) in Chile; null means the team's days;
--   starts_on           the day the plan begins: what they left unopened before it does not count for the rest of two weeks
--                       (restingFromDrops), so a person who was resting starts again with it.
--
-- Like the team's plan it is part of what was agreed, so the people of the team neither read nor change it: row security is on
-- with no policy, and only the server (service_role) and whoever operates the database reach the table. Forward-only and inert
-- on its own: without rows everybody keeps their team's plan.
create table if not exists public.lead_drop_person_plans (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_drop_size smallint not null,
  lead_drop_weekdays smallint[],
  starts_on date not null default ((now() at time zone 'America/Santiago')::date),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint lead_drop_person_plans_size_check check (lead_drop_size between 1 and 10),
  constraint lead_drop_person_plans_weekdays_check check (
    lead_drop_weekdays is null
    or (cardinality(lead_drop_weekdays) between 1 and 5 and lead_drop_weekdays <@ array[1, 2, 3, 4, 5]::smallint[])
  )
);

alter table public.lead_drop_person_plans enable row level security;
revoke all on table public.lead_drop_person_plans from public, anon, authenticated;
grant select, insert, update, delete on table public.lead_drop_person_plans to service_role;

comment on table public.lead_drop_person_plans is
  'A person''s own «Contacto del día» plan in a workspace, over the team''s. Set by the server or the operator, never by the team.';
comment on column public.lead_drop_person_plans.lead_drop_weekdays is
  'Days of this person''s contacts, 1 (Monday) to 5 (Friday), in Chile. Null: the days of their team.';
comment on column public.lead_drop_person_plans.starts_on is
  'The day the plan begins; contacts left unopened before it do not count towards the rest of two weeks.';
