-- The Antonia exception queue is server-owned and has no direct client path.
alter table public.antonia_exceptions enable row level security;

do $$
declare
  p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'antonia_exceptions'
  loop execute format('drop policy if exists %I on public.antonia_exceptions', p.policyname); end loop;
end;
$$;

revoke all on table public.antonia_exceptions from public, anon, authenticated;
grant all on table public.antonia_exceptions to service_role;

comment on table public.antonia_exceptions is
  'Server-owned Antonia exception queue. Client roles have no direct access.';
