-- Plan 15: when the daily search of «Oportunidades» runs, chosen by the person in «Ajustes de la búsqueda». Until now it ran
-- every morning at 08:15 for everyone. Days are 0 (domingo) to 6 (sábado) and the hour is Chilean time; the defaults keep
-- today's behavior (every day, 8 in the morning). Additive: the app reads the old profile shape until this is applied.
alter table public.commercial_opportunity_profiles
  add column if not exists schedule_enabled boolean not null default true,
  add column if not exists schedule_days smallint[] not null default '{0,1,2,3,4,5,6}',
  add column if not exists schedule_hour smallint not null default 8;

alter table public.commercial_opportunity_profiles
  drop constraint if exists commercial_opportunity_profiles_schedule_check;
alter table public.commercial_opportunity_profiles
  add constraint commercial_opportunity_profiles_schedule_check check (
    schedule_hour between 0 and 23
    and cardinality(schedule_days) between 1 and 7
    and schedule_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  );

notify pgrst, 'reload schema';
