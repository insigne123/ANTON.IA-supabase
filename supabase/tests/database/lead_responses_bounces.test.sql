begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(3);

-- Reply ingestion writes replies and bounces; the check admits both and still rejects a type nobody writes.
select lives_ok(
  $$insert into public.lead_responses (type, content) values ('bounce', 'pgtap bounce')$$,
  'a bounce can be recorded'
);
select lives_ok(
  $$insert into public.lead_responses (type, content) values ('reply', 'pgtap reply')$$,
  'a reply can still be recorded'
);
select throws_ok(
  $$insert into public.lead_responses (type, content) values ('positive', 'pgtap other')$$,
  '23514',
  null,
  'a type that is not written is rejected'
);

select * from finish();
rollback;
