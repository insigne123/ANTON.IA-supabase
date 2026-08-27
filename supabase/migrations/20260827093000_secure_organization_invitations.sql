-- Move organization invitations from plaintext bearer tokens to hashed,
-- auditable state without allowing malformed legacy rows to block rollout.
alter table public.organization_invites
  alter column token drop not null,
  add column if not exists token_hash text,
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by uuid references auth.users(id) on delete set null,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users(id) on delete set null;

-- Owner invitations were supported by the legacy table but are not valid in
-- V1. Preserve the row as a member invitation when its token is otherwise valid.
update public.organization_invites
set role = 'member'
where role is null or role not in ('admin', 'member');

update public.organization_invites
set token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
where token_hash is null
  and nullif(trim(token), '') is not null;

-- Invalid bearer material is retained only as a revoked audit row. A stable,
-- row-specific hash satisfies the final non-null contract without creating a
-- usable invitation.
update public.organization_invites
set
  revoked_at = coalesce(revoked_at, now()),
  token_hash = encode(extensions.digest(concat('revoked:', id::text), 'sha256'), 'hex')
where token_hash is null or token_hash !~ '^[a-f0-9]{64}$';

-- Keep only the newest active invitation for a normalized email address.
with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, lower(trim(email))
      order by expires_at desc, created_at desc, id desc
    ) as position
  from public.organization_invites
  where accepted_at is null and revoked_at is null
)
update public.organization_invites oi
set revoked_at = now()
from ranked r
where oi.id = r.id and r.position > 1;

update public.organization_invites set token = null where token is not null;

alter table public.organization_invites
  alter column token_hash set not null,
  drop constraint if exists organization_invites_role_check,
  add constraint organization_invites_role_check check (role in ('admin', 'member')),
  drop constraint if exists organization_invites_email_organization_id_key,
  add constraint organization_invites_token_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  add constraint organization_invites_state_check check (
    not (accepted_at is not null and revoked_at is not null)
  );

create unique index if not exists organization_invites_token_hash_uidx
  on public.organization_invites(token_hash);
create unique index if not exists organization_invites_active_email_uidx
  on public.organization_invites(organization_id, lower(trim(email)))
  where accepted_at is null and revoked_at is null;
create index if not exists organization_invites_pending_idx
  on public.organization_invites(organization_id, expires_at)
  where accepted_at is null and revoked_at is null;

create or replace function public.organization_has_role_v1(
  p_organization_id uuid,
  p_roles text[] default array['owner', 'admin', 'member']::text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.role = any(p_roles)
  );
$$;

revoke all on function public.organization_has_role_v1(uuid, text[]) from public;
grant execute on function public.organization_has_role_v1(uuid, text[]) to authenticated, service_role;

notify pgrst, 'reload schema';
