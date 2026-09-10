# Company-first search checkpoints

## Implementation

- Company search uses keyword tags; per-company people search uses organization ID and person filters.
- Default is 50 per company. Expansion keeps each company's page size stable.
- Continuation uses provider total/raw count, not the count remaining after saved-contact exclusion.
- Failed initial requests retain page zero so retry requests page one.
- Saved-contact exclusion queries Apollo provider IDs in leads, enriched leads and enriched opportunities within the authenticated workspace. Legacy records without provider identity are not covered by this check.
- Checkpoints save the last filter workspace per user/organization. Revision compare-and-swap rejects stale writes from another tab. This is a UI checkpoint, not a provider-operation ledger or a history of every search.
- Reload restores filters, companies, selected companies, active window, contacts and page cursors; loading flags are cleared.
- Checkpoint persistence is debounced 400ms; an abrupt close before a write completes may lose the latest update. A refresh during a provider request may repeat that request. Provider calls are not transactional with checkpoints.

## Activation

Migration `20260911100000_search_workspace_checkpoints.sql` was applied to production `yfdelflsheurzaicwayi` on 2026-09-10 with explicit user authorization and verified immediately after:
columns (organization_id, user_id, revision, snapshot, updated_at) with expected types/defaults; PK (organization_id, user_id); FKs to organizations(id) and auth.users(id) with ON DELETE CASCADE; both CHECK constraints present; RLS enabled; anon/authenticated hold zero grants (only postgres and service_role appear in role_table_grants). API scope comes from authenticated membership, not the snapshot.

## Deployment 2026-09-10

- Gateway `backend-antonia` (project `backend-apollo-leads-prod`, source repo `insigne123/Backend-leads`) received commit `a63bd7d` with `organization_search` / `organization_people` modes; rollout completed ~15:26 UTC. Verified live: `/api/lead-search` responds 401 without secret (auth enforced, service up).
- App `studio` (project `leadflowai-3yjcy`) deployed from clean main `91e7cd5` via `firebase deploy --only apphosting:studio`; `/login` serves, `/api/leads/search/checkpoint` responds 401 without session (route live and protected).
- Correction to the earlier reconstruction: production never sent `q_keywords`. The legacy batch flow maps industries to Apollo `organization_industry_tag_ids[]` (e.g. Apparel & Fashion → `5567cd82736964540d0b0000`) plus `q_organization_keyword_tags[]` for company keywords. The local `backend/` mirror was aligned to the same mapping, with its tests updated accordingly.
- Remaining: end-to-end check with a real authenticated browser session (company search → select → per-company windows → expand → reload recovery).

Deploy backend and app after applying and verifying the migration. Confirm read/write/reload with a real authenticated browser, two tabs and two workspaces. No real Apollo call, browser visual audit or deployment was performed in this continuation.

## Validation

- Node 22.23.2.
- Backend suite: 26 passing tests.
- Checkpoint, search security and client suites: 18 passing tests.
- TypeScript check passed before final copy-only UI changes; rerun recorded in session.
- Read-only production schema inspection confirmed organization UUID and provider identity columns used by exclusions.

## Remaining limitations

- Legacy batch/automated search still has its previous industry keyword contract; only the new company-first UI follows the new endpoint flow.
- Expansion retrieves one provider page per action, so it can deliver fewer than 50 new contacts if saved/duplicate contacts fill that page; users may continue when provider metadata indicates more results.
- Checkpoint conflicts prevent overwrite but do not lock provider searches across tabs.
- Visual responsive/keyboard verification and production smoke testing remain pending.
