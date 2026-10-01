begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(5);

-- Plan 5, PR-6b: the mailbox that sends by default lives on the person's own profile.
insert into auth.users (id, email, email_confirmed_at)
values ('f0000000-0000-4000-8000-000000000001', 'pgtap-default-sender@antonia.test', now());
insert into public.profiles (id) values ('f0000000-0000-4000-8000-000000000001') on conflict (id) do nothing;

select has_column('public', 'profiles', 'default_mail_provider', 'profiles keep the mailbox that sends by default');
select is((select default_mail_provider from public.profiles where id = 'f0000000-0000-4000-8000-000000000001'), null,
  'nobody chose one yet: the only connected mailbox sends');
select lives_ok($$update public.profiles set default_mail_provider = 'outlook' where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'Outlook can be chosen');
select lives_ok($$update public.profiles set default_mail_provider = null where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'the choice can be cleared');
select throws_ok($$update public.profiles set default_mail_provider = 'yahoo' where id = 'f0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'only Gmail (google) or Outlook');

select * from finish();
rollback;
