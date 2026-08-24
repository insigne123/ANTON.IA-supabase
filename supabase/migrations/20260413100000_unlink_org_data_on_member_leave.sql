create or replace function public.unlink_member_owned_records_from_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leads
  set organization_id = null
  where organization_id = old.organization_id
    and user_id = old.user_id;

  update public.enriched_leads
  set organization_id = null
  where organization_id = old.organization_id
    and user_id = old.user_id;

  update public.contacted_leads
  set organization_id = null
  where organization_id = old.organization_id
    and user_id = old.user_id;

  update public.campaigns
  set organization_id = null
  where organization_id = old.organization_id
    and user_id = old.user_id;

  return old;
end;
$$;

drop trigger if exists organization_members_unlink_owned_records on public.organization_members;

create trigger organization_members_unlink_owned_records
after delete on public.organization_members
for each row
execute function public.unlink_member_owned_records_from_org();

update public.leads l
set organization_id = null
where organization_id is not null
  and not exists (
    select 1
    from public.organization_members om
    where om.organization_id = l.organization_id
      and om.user_id = l.user_id
  );

update public.enriched_leads l
set organization_id = null
where organization_id is not null
  and not exists (
    select 1
    from public.organization_members om
    where om.organization_id = l.organization_id
      and om.user_id = l.user_id
  );

update public.contacted_leads l
set organization_id = null
where organization_id is not null
  and not exists (
    select 1
    from public.organization_members om
    where om.organization_id = l.organization_id
      and om.user_id = l.user_id
  );

update public.campaigns c
set organization_id = null
where organization_id is not null
  and not exists (
    select 1
    from public.organization_members om
    where om.organization_id = c.organization_id
      and om.user_id = c.user_id
  );
