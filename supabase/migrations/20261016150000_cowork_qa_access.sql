-- Cowork for the QA account that evaluates it in production (16 Oct 2026): cowork_open_access names it next to the owner,
-- and it gets its grant. Everything else stays as 20260930020000_cowork_access_policy.sql left it: a grant, a confirmed
-- email and membership in the organization are still required, and open_to_grants stays off. The app's own list is in
-- src/lib/cowork/access.ts (COWORK_ALLOWED_EMAILS) with the ids in COWORK_OWNER_USER_ID and COWORK_ALLOWED_USER_IDS.

create or replace function public.cowork_open_access(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(trim(coalesce(p_email, ''))) in ('nicolas.yarur.g@yago.cl', 'nicolas.yarur.g+qa@yago.cl')
    or coalesce((select p.open_to_grants from public.cowork_access_policy p where p.singleton), false);
$$;

-- The QA account's grant, by its email (a database without that account, like a local one, gets none).
insert into public.cowork_access_grants (user_id, enabled)
select u.id, true from auth.users u where lower(trim(u.email)) = 'nicolas.yarur.g+qa@yago.cl'
on conflict (user_id) do update set enabled = true;
