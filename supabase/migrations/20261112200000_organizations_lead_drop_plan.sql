-- «Contacto del día» by organization (12 Nov 2026, docs/contacto-del-dia.md): how many contacts each person gets and on which days. Until
-- now it was one contact on Tuesdays, Wednesdays and Fridays for everyone (DROP_SIZE and DROP_WEEKDAYS in src/lib/lead-drops.ts); a team may
-- now get, for example, six every working day. Days are 1 (Monday) to 5 (Friday), in Chile.
--
-- It is part of what a team contracted, so the people of the team cannot change it: only the server and whoever operates the database.
alter table public.organizations
  add column if not exists lead_drop_size smallint not null default 1,
  add column if not exists lead_drop_weekdays smallint[] not null default '{2,3,5}';

alter table public.organizations drop constraint if exists organizations_lead_drop_size_check;
alter table public.organizations add constraint organizations_lead_drop_size_check check (lead_drop_size between 1 and 10);
alter table public.organizations drop constraint if exists organizations_lead_drop_weekdays_check;
alter table public.organizations add constraint organizations_lead_drop_weekdays_check
  check (cardinality(lead_drop_weekdays) between 1 and 5 and lead_drop_weekdays <@ array[1, 2, 3, 4, 5]::smallint[]);

comment on column public.organizations.lead_drop_size is
  'Contacts each person gets in a «Contacto del día» (1 to 10). Set by the server or the operator, never by the team.';
comment on column public.organizations.lead_drop_weekdays is
  'Days of the «Contacto del día», 1 (Monday) to 5 (Friday), in Chile. Set by the server or the operator, never by the team.';

create or replace function public.guard_organization_lead_drop_plan_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- A request of the API as a person (or without one) never sets the plan; the server (service_role) and a database session do.
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and (
    (tg_op = 'INSERT' and (new.lead_drop_size <> 1 or new.lead_drop_weekdays <> '{2,3,5}'::smallint[]))
    or (tg_op = 'UPDATE' and (new.lead_drop_size is distinct from old.lead_drop_size or new.lead_drop_weekdays is distinct from old.lead_drop_weekdays))
  ) then
    raise exception 'The lead drop plan is service-owned' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_organization_lead_drop_plan on public.organizations;
create trigger guard_organization_lead_drop_plan
  before insert or update of lead_drop_size, lead_drop_weekdays on public.organizations
  for each row execute function public.guard_organization_lead_drop_plan_v1();

revoke all on function public.guard_organization_lead_drop_plan_v1() from public, anon, authenticated;

notify pgrst, 'reload schema';
