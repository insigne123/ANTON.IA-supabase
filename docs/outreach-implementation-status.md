# Outreach implementation status

## Scope and isolation

Implementation on main, September 2026. Research/report work already present in the
shared worktree was not reverted or edited by this outreach implementation. The
existing Report V2 evidence adapter remains the source of drafting evidence.
Do not deploy the entire dirty worktree without coordinating the concurrent work.

## Implemented

- Bounded commercial brief with recipient role, canonical selected evidence,
  seller capabilities, restrictions and previous message bodies.
- Native draft prompt v9, template paragraph/bullet support, conservative numeric
  and conditional-claim checks. Structural readability and specified editorial wording
  can warn rather than block; provenance, tokens, unsupported numbers and unqualified
  hypotheses still block.
- Read-only AI proposals with Apply/Discard, optimistic version checks, explicit
  save requirements and protection against stale responses overwriting edits.
- Subject-only actions preserve the body client-side. Follow-up proposals can be
  prepared together and reviewed separately; partial failures retain successes.
- Legacy compose entry points route through canonical preparation.
- Personal/team template library, scoped permissions, duplication, archive,
  expected revisions and transactional defaults.
- Six editable GrupoExpro-inspired reference templates. Not official marketing
  approval, not automatically assigned to an organization, no imported guarantees.
- Atomic revision plus provenance RPC; edited content requires renewed approval.
- Explicit API delivery modes: new_message, reply_first, reply_previous.
  Gmail reply modes resolve and verify a canonical parent. Existing callers keep
  new-message behavior. Unknown send outcomes remain protected against retries.
- Reply scanning filters eligible rows before limiting, supports a cursor and
  rejects sender-only attribution; provider failure is not an empty reply result.

## Deployment dependencies

Status reconciled on 2026-09-09 from the recorded deployment and the prior review
reported by the user, not a new remote verification in this documentation pass.
The prior `main` application rollout completed at 13:47 UTC. That does not mean
subsequent changes in the concurrent dirty worktree have been deployed.

Both migrations were applied individually to production with explicit user
authorization on September 9, 2026. Application deployment subsequently completed
through `firebase deploy --only apphosting -P leadflowai-3yjcy --non-interactive`
after Firebase reauthentication. Firebase confirmed rollout completion for studio.
Production `/api/ai/health` returned `ok: true` and `/login` responded. Cloud Run
revision/log inspection through gcloud was blocked by its separate expired session.
No authenticated browser workflow or live email send was exercised. Functions were
not deployed. Migration source files:

1. supabase/migrations/20260909120000_email_template_library.sql
2. supabase/migrations/20260909160000_atomic_native_draft_revision.sql

The MCP assigned production versions `20260909131929` (email_template_library)
and `20260909132044` (atomic_native_draft_revision). Local source filenames retain
their original versions; reconcile migration history before any future CLI push,
and do not reapply these files merely because their timestamps differ.
See [Migration History Reconciliation](migration-history-reconciliation.md) for
the recorded mappings, missing SQL-comparison proof and concurrency restrictions.

The prior read-only review confirmed that `library_scope`, `archived_at`,
`source_collection`, `published_by` and `published_at`, and the atomic revision
RPC were available through PostgREST. The five-missing-columns deployment blocker
in the early Constanza investigation is historical, not a current prerequisite.
API availability does not prove equality of local SQL and stored migration statements.

Post-apply catalog verification confirmed valid template indexes, the existing
personal template retained, RLS enabled on template/draft/version/metadata tables,
and service-role-only execution of the atomic revision RPC. Research/report
function, column and RLS-policy hashes matched their pre-apply values exactly:

- Functions: 113d02b22032e3c2116287437a287cca
- Columns: f2c65b26cd5745c7d3fe4bfdbcb9ed37
- Policies: e4ac2cfeaf0799ecbef93f717ff8dda9

No production seeds, test suites, mail sends or research/report writes were run
  by that outreach deployment. Runtime logs remain unverified; the recorded health
  and login HTTP checks passed. The latest studio rollout completed on September 9,
  2026 after the preflight editorial/numeric correction; `/api/ai/health` returned
  `ok: true`. Authenticated application workflows remain unverified.
This documentation pass made no remote calls or production writes.

The first changes only email template storage/policies/RPCs. The second wraps
native message revision and metadata persistence atomically. Neither is the
concurrent public-company research migration. Do not use a bulk db push that
implicitly applies unrelated pending migrations. Recheck current schema, RLS,
permissions, migration history and available logs around each authorized write.
The database prerequisites are installed. Before the 13:47 UTC rollout, the old
style API's multi-update default handling was incompatible with the strict revision
trigger; that was a release-order warning, not an outstanding initial deployment.
Authenticated template-default behavior still needs validation, and later local
library changes require their own coordinated review.

## Validation

- Node 22.23.2, npm run test:unit: 1,025 passed, zero failed/skipped.
- npm run typecheck: passed after the final UI/template iteration.
- Unit runner strips credentials and disables outbound side effects; no
  .env.local was loaded by the suites.
- scripts/evaluate-draft-quality.test.ts (separate from default src test discovery):
  six grounded fixtures accepted; 24 adversarial variants rejected.
- Deterministic context comparison, old v8 projection versus new brief:
  role 0/6 -> 6/6; relevant service 4/6 -> 6/6; prior body 0/6 -> 6/6;
  factual anchor 6/6 -> 6/6.
- Additional migration validation was performed in isolated PostgreSQL/WASM
  by the implementation agents, not against production.

These metrics measure context availability and guard behavior, not live-model
naturalness, factual entailment, conversion, or real provider delivery.

## Remaining plan work

- Verify the latest studio rollout in the authenticated interface and treatment of
  its remaining reported rejection details; the preflight correction is deployed.
- Unify organization commercial profile resolution for research and mail without
  editing concurrent seller/research changes; pin commercial/style revisions.
- Support changing template through preview with authenticated proposal lineage.
  Current preview deliberately retains its original style; persisted rewrite API
  can change style, but this is not exposed as a misleading preview operation.
- Add user-facing history/restore and persistent crash recovery/autosave.
- Add business-day cadence, holidays/timezone policy, alternate contacts,
  cross-company coordination and manual LinkedIn/phone tasks.
- Persist/expose delivery modes in campaign UI and implement durable native
  Outlook replies. Outlook new-message sending remains supported; explicit
  Outlook reply modes are rejected, never silently converted to new mail.
- Persist/pass reply-sync cursor across scheduler runs for complete scan fairness.
- Obtain marketing approval of claims and intentionally publish templates in the
  correct GrupoExpro workspace; complete role/sequence-specific library variants.
- Browser validation of desktop/mobile, real Radix focus behavior, navigation,
  light/dark, and connected-provider smoke tests without contacting real prospects.
- Live-model blind comparison on authorized anonymized lead examples, with
  commercial reviewers rating naturalness/relevance and measuring edit effort.

Do not report the entire original plan as complete until these items are resolved.
