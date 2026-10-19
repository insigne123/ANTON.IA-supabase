-- Cowork for every account (19 Oct 2026, owner's decision): cowork_open_access(email) is true for anyone once
-- open_to_grants is on (20260930020000_cowork_access_policy.sql). Every other condition stays: an enabled grant in
-- cowork_access_grants (the app creates it on a person's first visit and never turns one back on), a confirmed email and
-- membership in the organization. To close it again: update public.cowork_access_policy set open_to_grants = false.
update public.cowork_access_policy set open_to_grants = true, updated_at = now() where singleton;
