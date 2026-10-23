begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(17);

-- The verified owner (the only Cowork account today) and an outsider.
insert into auth.users (id, email, email_confirmed_at)
values ('d0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now()),
  ('d0000000-0000-4000-8000-000000000002', 'pgtap-cowork-schedules-outsider@antonia.test', now());
insert into public.organizations (id, name) values ('d1000000-0000-4000-8000-000000000001', 'pgTAP Cowork tareas programadas');
insert into public.organization_members (organization_id, user_id, role)
values ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'owner'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'member');
insert into public.cowork_access_grants (user_id, enabled) values ('d0000000-0000-4000-8000-000000000001', true);

select has_table('public', 'cowork_scheduled_tasks', 'scheduled tasks have their table');
select ok((select relrowsecurity from pg_class where oid = 'public.cowork_scheduled_tasks'::regclass), 'with RLS on');
select ok(has_table_privilege('authenticated', 'public.cowork_scheduled_tasks', 'select')
  and not has_table_privilege('authenticated', 'public.cowork_scheduled_tasks', 'insert')
  and not has_table_privilege('authenticated', 'public.cowork_scheduled_tasks', 'update')
  and not has_table_privilege('authenticated', 'public.cowork_scheduled_tasks', 'delete')
  and not has_table_privilege('anon', 'public.cowork_scheduled_tasks', 'select'),
  'signed-in accounts only read it; anonymous visitors get nothing');

select lives_ok($$
  insert into public.cowork_scheduled_tasks (id, user_id, organization_id, title, prompt, frequency, time_of_day, weekday, status, next_run_at)
  values ('d2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
    'Resumen del lunes', 'Dime quién respondió esta semana y a quién escribir hoy.', 'weekly', '09:00', 1, 'active', now() + interval '1 day')
$$, 'the server schedules a weekly task');
select throws_ok($$
  insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, status, next_run_at)
  values ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
    'Semanal sin día', 'Dime quién respondió esta semana y a quién escribir hoy.', 'weekly', '09:00', 'active', now())
$$, '23514', null, 'a weekly task needs its weekday');
select throws_ok($$
  insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, weekday, status, next_run_at)
  values ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
    'Diaria con día', 'Dime quién respondió esta semana y a quién escribir hoy.', 'daily', '09:00', 3, 'active', now())
$$, '23514', null, 'a daily task has no weekday');
select throws_ok($$
  insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, month_day, status, next_run_at)
  values ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
    'Mensual día 31', 'Dime quién respondió esta semana y a quién escribir hoy.', 'monthly', '09:00', 31, 'active', now())
$$, '23514', null, 'the day of the month stops at 28');
select throws_ok($$
  insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, status, next_run_at)
  values ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
    'Hora mala', 'Dime quién respondió esta semana y a quién escribir hoy.', 'daily', '9:00', 'active', now())
$$, '23514', null, 'the time is HH:MM');
select throws_ok($$
  insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, status)
  values ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
    'Activa sin próxima fecha', 'Dime quién respondió esta semana y a quién escribir hoy.', 'daily', '09:00', 'active')
$$, '23514', null, 'an active task knows when it fires next');
select throws_ok($$
  insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, status, next_run_at)
  values ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
    'Pausada con fecha', 'Dime quién respondió esta semana y a quién escribir hoy.', 'daily', '09:00', 'paused', now())
$$, '23514', null, 'a paused task has no next firing');
select throws_ok($$
  insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, status, next_run_at)
  values ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
    ' Con espacios ', 'Dime quién respondió esta semana y a quién escribir hoy.', 'daily', '09:00', 'active', now())
$$, '23514', null, 'a title is stored trimmed');

-- The limits: five active tasks at once and twenty in all.
insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, status, next_run_at)
select 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Tarea ' || n,
  'Dime quién respondió esta semana y a quién escribir hoy.', 'daily', '09:00', 'active', now() + interval '1 day'
from generate_series(1, 4) n;
select throws_ok($$
  insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, status, next_run_at)
  values ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
    'La sexta', 'Dime quién respondió esta semana y a quién escribir hoy.', 'daily', '09:00', 'active', now())
$$, '23514', 'Too many active scheduled tasks', 'a sixth active task is refused');
select lives_ok($$
  insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, status)
  values ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
    'Pausada', 'Dime quién respondió esta semana y a quién escribir hoy.', 'daily', '09:00', 'paused')
$$, 'a paused one does not count');
select throws_ok($$
  update public.cowork_scheduled_tasks set status = 'active', next_run_at = now() where title = 'Pausada'
$$, '23514', 'Too many active scheduled tasks', 'turning it on again counts');
insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, status)
select 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Pausada ' || n,
  'Dime quién respondió esta semana y a quién escribir hoy.', 'daily', '09:00', 'paused'
from generate_series(1, 14) n;
select throws_ok($$
  insert into public.cowork_scheduled_tasks (user_id, organization_id, title, prompt, frequency, time_of_day, status)
  values ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
    'La vigésimo primera', 'Dime quién respondió esta semana y a quién escribir hoy.', 'daily', '09:00', 'paused')
$$, '23514', 'Too many scheduled tasks', 'a person has at most twenty tasks');

-- The owner reads their rows; another member of the organization sees none.
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*)::integer from public.cowork_scheduled_tasks), 20, 'the owner reads their tasks');
reset role;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is_empty($$select 1 from public.cowork_scheduled_tasks$$, 'another member sees none');
reset role;

select * from finish();
rollback;
