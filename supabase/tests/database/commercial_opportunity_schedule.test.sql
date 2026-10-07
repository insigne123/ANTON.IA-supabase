begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(6);

insert into public.organizations (id, name) values ('ce000000-0000-4000-8000-0000000000a1', 'Horario QA');
insert into public.commercial_opportunity_profiles (id, organization_id, name)
values ('ce000000-0000-4000-8000-0000000000b1', 'ce000000-0000-4000-8000-0000000000a1', 'Qué buscamos');

select has_column('public', 'commercial_opportunity_profiles', 'schedule_days', 'the days of the daily search are kept with the profile');
select is(
  (select row(schedule_enabled, schedule_days, schedule_hour)::text from public.commercial_opportunity_profiles where id = 'ce000000-0000-4000-8000-0000000000b1'),
  '(t,"{0,1,2,3,4,5,6}",8)',
  'an existing profile keeps searching every day at 8'
);
select lives_ok($$
  update public.commercial_opportunity_profiles set schedule_days = '{1,2,3,4,5}', schedule_hour = 7, schedule_enabled = false
  where id = 'ce000000-0000-4000-8000-0000000000b1'
$$, 'weekdays at 7, or paused');
select throws_ok($$
  update public.commercial_opportunity_profiles set schedule_hour = 24 where id = 'ce000000-0000-4000-8000-0000000000b1'
$$, '23514', null, 'an hour out of the day is refused');
select throws_ok($$
  update public.commercial_opportunity_profiles set schedule_days = '{}' where id = 'ce000000-0000-4000-8000-0000000000b1'
$$, '23514', null, 'at least one day');
select throws_ok($$
  update public.commercial_opportunity_profiles set schedule_days = '{1,7}' where id = 'ce000000-0000-4000-8000-0000000000b1'
$$, '23514', null, 'days are 0 to 6');

select * from finish();
rollback;
