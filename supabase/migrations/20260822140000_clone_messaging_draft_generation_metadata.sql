-- Keep immutable generation lineage aligned with every immutable draft version.
-- Approval creates its child revision inside SQL, so application code cannot safely
-- add metadata after the version becomes ready for delivery.

create or replace function public.clone_messaging_draft_generation_metadata_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_version_id is null then
    return new;
  end if;

  insert into public.messaging_draft_generation_metadata (
    version_id,
    draft_id,
    organization_id,
    user_id,
    research_snapshot_id,
    generation_method,
    provider,
    model,
    prompt_version,
    style_profile_id,
    claim_ids
  )
  select
    new.id,
    new.draft_id,
    new.organization_id,
    new.user_id,
    metadata.research_snapshot_id,
    metadata.generation_method,
    metadata.provider,
    metadata.model,
    metadata.prompt_version,
    metadata.style_profile_id,
    metadata.claim_ids
  from public.messaging_draft_generation_metadata metadata
  where metadata.version_id = new.parent_version_id
    and metadata.draft_id = new.draft_id
    and metadata.organization_id = new.organization_id
    and metadata.user_id = new.user_id
  on conflict (version_id) do nothing;

  return new;
end;
$$;

revoke all on function public.clone_messaging_draft_generation_metadata_v1() from public, anon, authenticated;

drop trigger if exists clone_messaging_draft_generation_metadata_v1 on public.messaging_draft_versions;
create trigger clone_messaging_draft_generation_metadata_v1
  after insert on public.messaging_draft_versions
  for each row
  execute function public.clone_messaging_draft_generation_metadata_v1();

notify pgrst, 'reload schema';
