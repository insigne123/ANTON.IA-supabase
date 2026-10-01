-- Plan 5, PR-6b: the person chooses once, in Conexiones, which connected mailbox sends their emails (Gmail or
-- Outlook). Cowork and the campaigns use it instead of asking every time. Nullable: without a choice, the only
-- connected mailbox is used, as before. Read and written by the owner under the existing policies of profiles.
alter table public.profiles add column if not exists default_mail_provider text;
alter table public.profiles drop constraint if exists profiles_default_mail_provider_check;
alter table public.profiles add constraint profiles_default_mail_provider_check
  check (default_mail_provider is null or default_mail_provider in ('google', 'outlook'));
comment on column public.profiles.default_mail_provider is 'Mailbox that sends by default (google or outlook); null uses the only connected one.';
