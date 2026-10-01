begin;
select plan(5);

-- The repair rule of 20261001200000_leads_identity_backfill.sql, run on fixtures: only a hidden name of the same person,
-- inside the same account, is replaced; a typed name and another account stay.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'identity-a@example.com'),
  ('00000000-0000-4000-8000-0000000000e2', 'identity-b@example.com');

insert into public.leads (id, user_id, name, title, company, source_provider_id, linkedin_url) values
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000000e1', 'Rafael Du***n', 'Jefe de Operaciones', 'R&D Montajes', 'ap-1', null),
  ('00000000-0000-4000-8000-0000000001a2', '00000000-0000-4000-8000-0000000000e1', 'Susana Ca***s', 'Human Resources Manager', 'MSTI', null, null),
  ('00000000-0000-4000-8000-0000000001a3', '00000000-0000-4000-8000-0000000000e1', 'Ana Pérez', 'Gerente', 'Acme', 'ap-3', null),
  ('00000000-0000-4000-8000-0000000001a4', '00000000-0000-4000-8000-0000000000e2', 'Jose Ca***o', 'Reclutador', 'GrupoExpro', 'ap-4', null);

insert into public.enriched_leads (id, user_id, full_name, linkedin_url, source_provider_id, data) values
  ('enriched-1', '00000000-0000-4000-8000-0000000000e1', 'Rafael Durán', 'https://www.linkedin.com/in/rafael-duran', 'ap-1', '{}'),
  ('enriched-2', '00000000-0000-4000-8000-0000000000e1', 'Susana Cáceres', null, null, '{"sourceSavedLeadId":"00000000-0000-4000-8000-0000000001a2"}'),
  ('enriched-3', '00000000-0000-4000-8000-0000000000e1', 'Ana María Pérez', null, 'ap-3', '{}'),
  ('enriched-4', '00000000-0000-4000-8000-0000000000e1', 'Jose Castro', null, 'ap-4', '{}');

with matched as (
  select distinct on (l.id) l.id, e.full_name, e.linkedin_url
  from public.leads l
  join public.enriched_leads e
    on e.user_id = l.user_id
   and e.organization_id is not distinct from l.organization_id
   and (
     e.data ->> 'sourceSavedLeadId' = l.id::text
     or (nullif(l.source_provider_id, '') is not null and e.source_provider_id = l.source_provider_id)
     or (nullif(l.apollo_id, '') is not null and e.source_provider_id = l.apollo_id)
   )
  where l.name like '%***%'
    and coalesce(e.full_name, '') <> ''
    and e.full_name not like '%***%'
  order by l.id, e.updated_at desc nulls last
)
update public.leads l
set name = m.full_name,
    linkedin_url = coalesce(nullif(l.linkedin_url, ''), nullif(m.linkedin_url, ''))
from matched m
where l.id = m.id
  and l.name like '%***%';

select is((select name from public.leads where id = '00000000-0000-4000-8000-0000000001a1'), 'Rafael Durán',
  'a hidden name takes the real one from the lookup with the same provider id');
select is((select linkedin_url from public.leads where id = '00000000-0000-4000-8000-0000000001a1'), 'https://www.linkedin.com/in/rafael-duran',
  'and its LinkedIn');
select is((select name from public.leads where id = '00000000-0000-4000-8000-0000000001a2'), 'Susana Cáceres',
  'a lookup that points at the saved contact counts too');
select is((select name from public.leads where id = '00000000-0000-4000-8000-0000000001a3'), 'Ana Pérez',
  'a complete name is never replaced');
select is((select name from public.leads where id = '00000000-0000-4000-8000-0000000001a4'), 'Jose Ca***o',
  'another account''s lookup never repairs this one');

select * from finish();
rollback;
