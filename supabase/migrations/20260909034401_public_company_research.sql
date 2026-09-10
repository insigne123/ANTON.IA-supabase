-- Separate public web evidence from legacy provider and personalized artifacts.
create table public.public_company_research (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  identity jsonb not null check (jsonb_typeof(identity) = 'object'),
  revision integer not null default 0 check (revision >= 0),
  payload jsonb,
  captured_at timestamptz,
  expires_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  unique (organization_id, identity),
  check ((lease_token is null) = (lease_until is null)),
  check ((payload is null and captured_at is null and expires_at is null)
    or (payload is not null and jsonb_typeof(payload) = 'object' and captured_at is not null
      and expires_at is not null and expires_at > captured_at and expires_at <= captured_at + interval '24 hours'))
);
alter table public.public_company_research enable row level security;
revoke all on public.public_company_research from public, anon, authenticated;
-- Do not expose lease tokens to tenant readers.
grant select (id, organization_id, identity, revision, payload, captured_at, expires_at)
  on public.public_company_research to authenticated;
grant all on public.public_company_research to service_role;
create policy public_company_research_read on public.public_company_research
  for select to authenticated using (public.is_current_user_organization_member(organization_id));

create function public.claim_public_company_research_v1(
  p_organization_id uuid, p_identity jsonb, p_refresh boolean default false
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare r public.public_company_research%rowtype; expired boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_identity is null or jsonb_typeof(p_identity) <> 'object'
     or not (p_identity ?& array['apolloOrganizationId','domain','country','language','depth','version'])
     or p_identity - array['apolloOrganizationId','domain','country','language','depth','version'] <> '{}'::jsonb
     or coalesce(p_identity->>'apolloOrganizationId','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,254}$'
    or coalesce(p_identity->>'domain','') !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'
    or coalesce(p_identity->>'country','') !~ '^[A-Z]{2}$'
    or coalesce(p_identity->>'language','') !~ '^[a-z]{2,3}(-[a-z]{2})?$'
    or coalesce(p_identity->>'depth','') not in ('basic','standard','deep')
     or coalesce(p_identity->>'version','') <> 'public-company/2:report-v2/p3-claims/4' then
    raise exception 'invalid public identity' using errcode = '22023';
  end if;
  insert into public.public_company_research (organization_id, identity)
    values (p_organization_id, p_identity) on conflict (organization_id, identity) do nothing;
  select * into strict r from public.public_company_research
    where organization_id = p_organization_id and identity = p_identity for update;
  expired := r.payload is not null and r.expires_at <= clock_timestamp();
  if not coalesce(p_refresh, false) and r.expires_at > clock_timestamp() then
    return jsonb_build_object('state','hit','artifact',to_jsonb(r) - array['lease_token','lease_until']);
  end if;
  if r.lease_until > clock_timestamp() then
    return jsonb_build_object('state','busy','id',r.id,'expired',expired);
  end if;
  update public.public_company_research set lease_token = gen_random_uuid(),
    lease_until = clock_timestamp() + interval '5 minutes' where id = r.id returning * into r;
  return jsonb_build_object('state','miss','artifact',to_jsonb(r), 'expired',expired);
end;
$$;

create function public.complete_public_company_research_v1(
  p_organization_id uuid, p_id uuid, p_token uuid, p_payload jsonb,
  p_captured_at timestamptz, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare r public.public_company_research%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_captured_at is null or p_expires_at is null
    or p_captured_at > clock_timestamp() or p_expires_at <= clock_timestamp()
    or p_expires_at <= p_captured_at or p_expires_at > p_captured_at + interval '24 hours' then
    raise exception 'invalid public evidence lifetime' using errcode = '22023';
  end if;
  update public.public_company_research set payload = p_payload, captured_at = p_captured_at,
    expires_at = p_expires_at, revision = revision + 1, lease_token = null, lease_until = null
    where id = p_id and organization_id = p_organization_id and lease_token = p_token
      and lease_until > clock_timestamp() returning * into r;
  if not found then raise exception 'public research lease lost' using errcode = '55000'; end if;
  return to_jsonb(r) - array['lease_token','lease_until'];
end;
$$;

create function public.release_public_company_research_v1(p_organization_id uuid, p_id uuid, p_token uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Failed refreshes retain the previous revision and its original expiry.
  update public.public_company_research set lease_token = null, lease_until = null
    where id = p_id and organization_id = p_organization_id and lease_token = p_token
      and lease_until > clock_timestamp();
  return found;
end;
$$;
revoke all on function public.claim_public_company_research_v1(uuid,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.complete_public_company_research_v1(uuid,uuid,uuid,jsonb,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.release_public_company_research_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_public_company_research_v1(uuid,jsonb,boolean) to service_role;
grant execute on function public.complete_public_company_research_v1(uuid,uuid,uuid,jsonb,timestamptz,timestamptz) to service_role;
grant execute on function public.release_public_company_research_v1(uuid,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
