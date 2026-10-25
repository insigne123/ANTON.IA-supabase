-- COW-06: «Pedidos guardados». Cowork's «/» offered only its six fixed templates; now a person keeps the requests that worked
-- for them, and can share one with the team. One table, as cowork_thread_settings: the person reads their own and the shared
-- ones of their organization with their session (and Cowork access); only the server writes. Forward-only and inert on its own:
-- until it exists the app offers no saved requests.

create table public.cowork_prompts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Trimmed, 1 to 80 characters: the name in the «/» list.
  title text not null check (title = btrim(title) and char_length(title) between 1 and 80),
  -- The request as it goes to the composer, 3 to 4,000 characters.
  prompt text not null check (char_length(btrim(prompt)) between 3 and 4000),
  -- Shared: the whole organization sees it; otherwise only its author.
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cowork_prompts_scope on public.cowork_prompts(organization_id, user_id, updated_at desc);
alter table public.cowork_prompts enable row level security;
revoke all on public.cowork_prompts from public, anon, authenticated;
grant select on public.cowork_prompts to authenticated;
grant all on public.cowork_prompts to service_role;
create policy cowork_prompts_read on public.cowork_prompts for select to authenticated
  using ((user_id = auth.uid() or shared) and public.cowork_has_access(organization_id));

notify pgrst, 'reload schema';
