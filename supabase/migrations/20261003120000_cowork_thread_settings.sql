-- Plan 9 (c): rename and hide Cowork conversations. A conversation is the chain of runs joined by root_run_id (its first
-- run), and cowork_runs has no title; deleting runs is not an option either, since events, budgets and proposals point at
-- them. One row per conversation keeps the name its owner gave it and when they hid it from the list («Eliminar» in the
-- app hides it, with «Deshacer»). The owner reads their own rows with their session, while they have Cowork access; only
-- the server writes, with the service role, after checking that the conversation is theirs and not running.
-- Forward-only and inert on its own: nothing reads or writes it until the app ships its half, and the app keeps listing
-- conversations as today while this table does not exist.
create table public.cowork_thread_settings (
  root_run_id uuid primary key,
  user_id uuid not null,
  organization_id uuid not null,
  -- Trimmed, 1 to 120 characters; null keeps the first message as the name.
  title text check (title is null or (title = btrim(title) and char_length(title) between 1 and 120)),
  hidden_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (root_run_id, user_id, organization_id)
    references public.cowork_runs(id, user_id, organization_id) on delete cascade
);
create index cowork_thread_settings_scope on public.cowork_thread_settings(user_id, organization_id);
alter table public.cowork_thread_settings enable row level security;
revoke all on public.cowork_thread_settings from public, anon, authenticated;
grant select on public.cowork_thread_settings to authenticated;
grant all on public.cowork_thread_settings to service_role;
create policy cowork_thread_settings_private_read on public.cowork_thread_settings for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));
