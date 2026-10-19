-- The server's queries (service_role) get 30 s instead of the 8 s they inherit from the API's login role (authenticator).
-- On the free plan's database, which runs short of memory and swaps, Mercado público's history functions can take 8 to
-- 20 s even with their indexes (20261019151000), so the radar and the monthly reading of «Contratos por vencer» failed.
-- They run on the server only: the browser's roles keep their limits (anon 3 s, authenticated 8 s). PostgREST applies a
-- role's settings to each request of that role once it reloads its configuration.
-- To undo: alter role service_role reset statement_timeout; notify pgrst, 'reload config';

alter role service_role set statement_timeout = '30s';

notify pgrst, 'reload config';
