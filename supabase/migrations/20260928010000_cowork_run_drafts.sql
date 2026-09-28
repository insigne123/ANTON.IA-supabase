-- Live text of a Cowork answer while the model writes it, so the page can show it
-- word by word. One row per run, replaced on each write; the final answer still lives
-- only in the run.completed event. The row goes away with its run.
create table public.cowork_run_drafts (
  run_id uuid primary key,
  user_id uuid not null,
  organization_id uuid not null,
  text text not null default '' check (length(text) <= 20000),
  progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object'),
  updated_at timestamptz not null default now(),
  foreign key (run_id, user_id, organization_id)
    references public.cowork_runs(id, user_id, organization_id) on delete cascade
);
alter table public.cowork_run_drafts enable row level security;
revoke all on public.cowork_run_drafts from anon, authenticated;
grant select on public.cowork_run_drafts to authenticated;
grant all on public.cowork_run_drafts to service_role;
create policy cowork_drafts_private_read on public.cowork_run_drafts for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));

-- Same checks as cowork_record_tool_result: only the worker holding the live lease of a
-- running turn, for the verified owner, can write. It never changes the run itself.
create function public.cowork_write_run_draft(p_run_id uuid, p_token uuid, p_text text, p_progress jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare candidate public.cowork_runs;
begin
  if length(coalesce(p_text, '')) > 20000 then raise exception 'Cowork draft too long' using errcode = '22001'; end if;
  if p_progress is not null and (jsonb_typeof(p_progress) <> 'object' or pg_column_size(p_progress) > 4096) then
    raise exception 'Cowork draft progress invalid' using errcode = '22023';
  end if;
  select r.* into candidate from public.cowork_runs r
    where r.id = p_run_id and r.status = 'running' and r.lease_token = p_token and r.lease_expires_at > now()
      and exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
        where g.user_id = r.user_id and g.enabled and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null)
      and exists (select 1 from public.organization_members m where m.user_id = r.user_id and m.organization_id = r.organization_id);
  if not found then return false; end if;
  insert into public.cowork_run_drafts(run_id, user_id, organization_id, text, progress, updated_at)
    values (candidate.id, candidate.user_id, candidate.organization_id, coalesce(p_text, ''), coalesce(p_progress, '{}'::jsonb), now())
    on conflict (run_id) do update set text = excluded.text, progress = excluded.progress, updated_at = excluded.updated_at;
  return true;
end;
$$;
revoke all on function public.cowork_write_run_draft(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.cowork_write_run_draft(uuid, uuid, text, jsonb) to service_role;
