-- This baseline intentionally contains no production data.
-- Test identities and fixtures are created by idempotent bootstrap scripts.

-- Historical tables do not all grant PostgREST access uniformly. The local
-- fixture bootstrap uses the service role, which still bypasses every RLS
-- policy but also needs table privileges.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
