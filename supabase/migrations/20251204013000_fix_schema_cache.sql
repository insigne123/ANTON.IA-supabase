-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload config';

-- Also add a comment to the table to ensure a schema change event is registered
comment on table public.comments is 'Comments on entities like leads and campaigns';
