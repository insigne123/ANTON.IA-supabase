-- Production's excluded_domains kept the table defaults it was created with: anon with every privilege (TRUNCATE skips RLS)
-- and authenticated with UPDATE, TRUNCATE, TRIGGER and REFERENCES as well. Nothing reads it without a session (the privacy
-- route uses the service client) and the session client only lists, adds and removes rows (domain-service.ts), the three
-- things its policies allow. Each role keeps only that.
revoke all on table public.excluded_domains from anon;
revoke update, truncate, trigger, references on table public.excluded_domains from authenticated;
