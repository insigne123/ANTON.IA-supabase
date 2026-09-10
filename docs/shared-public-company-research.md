# Shared Public Company Research

## Constanza Follow-Up

See `constanza-research-investigation.md` for the initial production trace and
the authorized deployment/evaluation at 05:37-05:43 UTC. Team leads can now hydrate company
identity from an exact same-tenant Apollo row without importing another owner's
person context, even when the client omitted the stored website. This supersedes
the original-request-website enrollment limitation below and is now deployed.
The exact Constanza CL/deep/es cache collected cold, then the integrated V2 research
path reused it with zero company calls. A real personalized V2 report was generated
and reviewed locally in that early run. The later authorized publication enabled
organization-only V2 and persisted Constanza document
`93dc2415-f0d6-45e4-a526-01a978a32ecf` as completed/visible at 06:24:31 UTC.
The investigation also records the later 13:47 UTC application rollout; authenticated
browser validation remains outstanding. These are prior recorded results, not a
new remote verification in this documentation reconciliation.
Measured results, quality limitations and remaining release gates are in that
investigation. The PE/standard results below remain a separate historical run.

## Current Status (2026-09-09)

This status supersedes the historical rollout notes below.
- Production migration applied as `20260909034401_public_company_research`.
- Local source was renamed from `20260908190000_public_company_research.sql` to
  `20260909034401_public_company_research.sql` after the parent confirmed the
  production SQL comparison; local SQL contents are unchanged. See
  [Migration History Reconciliation](migration-history-reconciliation.md). Do not reapply it.
- Catalog checks confirmed RLS, the organization SELECT policy, hidden lease-token
  columns for authenticated readers, and service-only execution of the claim RPC.
  All three RPC signatures and fixed search paths were confirmed.
- Serper diagnosis confirmed HTTP 400 with `Query pattern not allowed for free
  accounts.` for the quoted-domain external query. `num: 4`, `gl: pe` and `hl: es`
  are accepted. The external query now uses a plain domain; exact-domain block
  matching and exclusion of official/subdomain sources remain enforced locally.
  Provider failures still fail closed; no empty-result fallback was introduced.
- Apollo IDs cannot survive a change of observed domain or contradict the nested
  provider domain. The native worker checks the current Apollo organization ID
  against the persisted shared identity before reading/collecting public evidence.
- Focused verification: 42 tests passed across cache, Apollo context, Serper and
  native security (27 unaffected passes plus 15 cache passes after updating the
  old query assertion). Node 22.23.2, sanitized runner, no env file in suites.
  Sequential build and typecheck passed. Next build uses its existing local env;
  this is not evidence of production configuration. `git diff --check` passed.
- One authorized cold operational collection after diagnosis succeeded against
  production using real collector/store/providers, followed by a warm read whose
  collector was forbidden. Evidence and references were exactly equal.
- Artifact `5c81d166-1490-4f19-94ad-6b6298a0e781`, revision 1: 4 official sources,
  21 raw facts, 20 claims. No external source passed the bounded evidence filter;
  the existing coverage warning remains applicable. SQL independently confirmed
  revision/counts, no active lease, capture `2026-09-09T04:35:23.966Z` and expiry
  `2026-09-10T04:35:23.966Z`.
- Cold: 34,082 ms, 3 Serper searches, 4 pages, 2 extraction batches. Warm: 138 ms,
  0 searches/pages/batches, no model call. Cold model telemetry recorded 4 successful
  `gpt-5.6-luna` calls, 5,451 prompt tokens and 2,279 completion tokens (7,730 total).
  Batches are not individual model-call counts. Monetary cost remains unknown.
  Separate Serper diagnosis made 7 bounded search requests, not included in cold
  metrics. No second cold attempt was needed.
- App Hosting `studio` correction deployed from `main` to `leadflowai-3yjcy` using
  `firebase deploy --only apphosting -P leadflowai-3yjcy`. CLI confirmed rollout
  completion, not just source upload. Post-deploy `/api/ai/health` returned
  `ok: true`. Shared enrollment remains enabled. Validation executed the server
  collector locally against production; it did not exercise a deployed
  authenticated browser/report workflow. No additional migration, email, seed,
  production test suite or commit was performed.
- Local production-config verification failed (GLM and missing local secrets);
  Secret Manager metadata confirmed the relevant production secrets exist, but
  this is not proof of runtime secret correctness. No commit was created.

## Checklist

Historical implementation checklist follows; the Current Status above is authoritative.
- [x] Inspect main and preserve existing dirty worktree.
- [x] Inspect production schema using read-only MCP SQL.
- [x] Prepare separate forward-only migration; do not apply to production.
- [x] Implement public-only contracts, leases, collection and graph adapters.
- [x] Integrate eligible native requests before company costs and their V2 checkpoint.
- [x] Test privacy, identities, graphs, expiry, leases and disabled rollout.
- [x] Run Node 22 sanitized focused tests and typecheck.
- [x] Record measured results, limitations and pending rollout.
- [ ] Principal agent: decide production migration, live validation and activation.

## Boundaries (Historical Pre-Rollout Notes)
The legacy `research_company_artifacts` table is not migrated or reused. Apollo
contact, owner, snapshot, seller and ICP inputs must never enter the new collector.
The stable Apollo organization ID may be used only as a server-derived identity key;
it is never sent as collector prompt context or stored with contact data.
No production migration, production test, commit or deployment has been executed
yet. Production writes remain limited to the explicitly authorized rollout steps.

## Architecture

`public_company_research` is a new table. One row per organization and strict
identity contains the last successful public graph and a separate generation
lease. The identity contains only the server-derived Apollo organization ID, exact
domain, country, language, requested depth and public collector/extractor version.
There is no user, lead, snapshot, seller, ICP, persona or private-context hash.
Organization is a separate required key, never a provider prompt field.

`publicCompanyCandidate` requires an explicit company domain, a matching HTTP/HTTPS
company website in the original native request and a validated Apollo organization
ID obtained server-side. HTTP advertisements are upgraded to an HTTPS exact-host
fetch; the collector never fetches them over HTTP. It does not accept name-only,
email-only or Apollo-only identity. A successful exact-host HTTPS root fetch is
required before publication. WWW is normalized; other subdomains, ports,
credentials and domain-changing redirects are not accepted. Existing pinned DNS,
private-address rejection and bounded HTTP fetching remain in use.

The collector has a fixed company-only search plan, bounded official-site
navigation, one external search and extraction with `providerContext: null`. External
HTTPS fetches pin redirects to the selected source host and retain only blocks
explicitly mentioning the exact target domain (not email or similar domains).
External sources remain `other`, never relabeled as official. It does not call the
persona/seller-aware V2 planner or entity resolver. Every raw fact, including
uncited facts, is checked against an actually fetched block before publication.
Strict graph validation checks content IDs, dates, references and public claim
dimensions. These checks prevent imported/context facts from being relabeled as
web facts. Public pages may themselves mention people; no private contact input
is supplied to this collector. A service-role compromise is outside this trust
boundary: SQL does not independently prove the semantic origin of JSON text.

## Pipeline Integration

For eligible requests, `native-research.ts` loads/claims the new artifact before
`collectCompanySignals`, `collectSearchSignals` and
`enrichCompanyResearchSnapshotV1`. All three legacy company stages are bypassed
on BOTH cold and warm shared runs; the new collector performs the cold public
work. Apollo lookup and contact research remain private and run per lead.

The native snapshot stores the public sources, all raw facts and claims with
artifact/revision-qualified IDs, plus `publicCompanyResearch` metadata. Private
subject, contact evidence, ownership and report generation remain unchanged.
The new company graph is incorporated before native quality/readiness scoring.

The V2 worker receives the reference through the snapshot. The adapter excludes
the lossy V1 copy of shared evidence; V2 loads the original graph before entering
the legacy personalized research checkpoint. A fresh hit performs no company
search, fetch or extraction. Expired evidence is collected under a new lease.
V2 merges the public graph with the current lead's private baseline, reassigning
source, fact and short claim IDs and derived inputs. Private internal claim IDs
are retained for existing contradiction/expiry checks. Public claim IDs and
stored report metadata retain artifact ID and revision.

Qualification, committee, seller reasoning, writing, full report audit and
repair remain per report. Uncited facts and original source timestamps are
preserved for the auditor. A cache hit does not bypass audit or grant a passed
status. Reports remain owner-scoped through existing access/persistence APIs.

## Leases And Freshness

- Claim uses the unique organization/identity row plus `FOR UPDATE`; concurrent
  inserts converge on the same row. Only one five-minute lease may be active.
- Complete/release require organization, artifact ID, token and an unexpired
  lease. A stale worker cannot publish or clear a successor's lease.
- Successful completion increments revision. Failed refresh leaves the prior
  payload, revision and expiry untouched. Ordinary readers can still hit that
  prior revision while it is valid; forced readers see busy.
- Busy native jobs return to queued without running contact/company providers.
  V2 busy propagates into the existing retryable synthesis failure mechanism.
- TTL is conservatively 24 hours for the entire graph, anchored to its OLDEST
  source retrieval time, not completion time or cache access. SQL also enforces
  the maximum lifetime. No hit or failed refresh renews it.
- This intentionally does NOT implement separate 30-day profile and 24-hour
  volatile-signal caches. Using 24 hours for both avoids mixed-age reuse and
  reduces the initial policy surface.
- V1 claims use the artifact expiry. The V2 snapshot adapter excludes expired
  factual claims while retaining audit evidence. Draft context rejects expired
  public report evidence rather than using its generic 30-day report window.
- Old snapshots/reports remain historical records; the table stores the current
  successful revision, not an append-only archive of every revision. Historical
  documents retain their own evidence and provenance.

## Security And Rollout

Migration: `supabase/migrations/20260909034401_public_company_research.sql`.
RLS uses the existing `is_current_user_organization_member` helper. Authenticated
members have column-level SELECT on public evidence metadata only, not lease
tokens; anonymous reads and tenant writes are denied. RPC execution is granted
only to service_role, with an additional `auth.role()` check and fixed search
path. There are no policies permitting authenticated writes.

`SHARED_PUBLIC_COMPANY_RESEARCH_ENABLED=true` enables enrollment for new eligible
native requests. Enrollment identity is persisted at enqueue from the original
request fields before Apollo merging; retries honor that identity, not the current
flag or enriched worker fields. Legacy jobs without this identity do not enroll.
It defaults OFF and was not set in any app environment here.
Existing V2 feature flags still govern V2 generation. A persisted shared
reference is honored even after enrollment is disabled, avoiding a fallback to
the private legacy collector for already-enrolled snapshots. Do not remove the
new table/functions as a rollback; disable enrollment instead.

Production MCP was used only to inspect current organization and legacy artifact
columns and consult documentation. No migration, data write, production test,
seed, reset, commit or deployment was executed. Apply and verify the migration
before activating enrollment. The principal agent owns that decision.

## Verification

Node `v22.23.2`. All suites used `scripts/run-node-tests.mjs`, which spawns a
sanitized allowlist environment with outbound side effects disabled. The runner
now accepts explicit workspace unit-test files. No `.env.local` was loaded;
these mocks/embedded SQL tests need no environment file or database credentials
(environment-dependent suites must use `.env.test.local`).

- Broad focused run: 171 passing tests, 0 failures, 18 files. Covered native
  contracts/snapshot/security/person, new cache, V2 contracts/projection/research/
  checkpoint/documents/worker, extraction/synthesis/audit and draft context.
- After the final TTL and private-lineage correction: 65 passing tests, 0
  failures across the affected new cache, draft-context and embedded SQL suites.
- After isolating server hashing from browser contracts and adding the V2
  country-mismatch guard: 23 passing tests, 0 failures across cache, V2 gather
  and snapshot contracts. These are targeted reruns, not additional unique tests.
- `npm run typecheck`: passed after the corrections.
- `git diff --check`: passed; existing CRLF conversion notices are not errors.
- No paid operational replay was used: 0 of the authorized maximum 2 calls.
  Provider spend attributable to this validation: USD 0. No live quality or
  monetary savings claim is made.

`scripts/public-company-sql.test.mjs` executes the ACTUAL migration in PGlite
(PostgreSQL WASM), with minimal organization/auth helper stubs. It tests function
execution, RLS visibility, column grants, forbidden writes, forced refresh,
expired/superseded tokens, organization isolation and TTL constraints. This is
not a SQL string assertion and is not SQL executed in Supabase production.
PGlite 0.5.8 was installed outside the repository at
`%LOCALAPPDATA%/Temp/opencode/public-company-sql`; no dependency/lockfile changed.
Run that test explicitly through the sanitized runner. PGlite is single-session:
it is not evidence of multi-connection PostgreSQL lock contention behavior.

Focused reproduction in this workspace:

```powershell
node scripts/run-node-tests.mjs scripts/public-company-sql.test.mjs src/lib/server/public-company-research.test.ts
npm run typecheck
```

`src/lib/server/public-company-research.test.ts` separately uses an in-memory RPC
mock to demonstrate simultaneous misses (one collector, one busy), late-token
rejection, cold/warm reuse and two private lead runs. It also invokes the native
snapshot builder and V2 shared gather branch, verifies derived references,
preserved uncited facts, hostile raw-fact injection with recomputed IDs, tenant
mismatch, country mismatch and no repeated V2 company stages. Worker orchestration
and existing report owner access are covered by their focused regression suites;
this is not a deployed end-to-end test.

## Metrics And Measured Limits

The native result's existing `companyResearchCache` now includes revision and
separate company/lead metrics. Company metrics report hit/miss/busy, expiry,
queries, successfully fetched pages, extraction batches and elapsed time. Lead
metrics report attempted queries and elapsed time. Public cache events are logged
without prompts or contact information. `costUsd` is deliberately `null`: no
authoritative provider invoice attribution is available. Existing synthesis model
telemetry remains separate. Failed partial collection attempts are not a complete
cost ledger, and successful-page counts are not counts of every redirect/request.

Mock cold/warm demonstration (not paid provider measurements):

| Phase | Company queries | Company pages | Extraction batches |
| --- | ---: | ---: | ---: |
| Cold fixture | 2 | 1 | 1 |
| Warm second lead | 0 | 0 | 0 |
| Warm V2 handoff | 0 | 0 | 0 |

Private lead searches still run for both contacts; separate private reports are
audited. The graph/timestamps are equal across cold/warm fixtures and ownership
remains caller-specific.

## Explicit Limitations

- Sharing covers NEW eligible native requests and their V2 handoff. Legacy
  snapshots without the reference, raw CLI `gatherReportV2Research` calls and
  requests without explicit matching website/domain retain their previous path.
  This is not a migration of all historic/standalone V2 research into shared mode.
- Coverage includes official sources and a bounded public external complement
  (one exact-domain query, four results, within the existing ten-attempt and
  three/six/eight-page budgets). External blocks without an explicit domain mention
  are omitted, so this is NOT equivalent to all prior press/name-based searches.
  WHOIS, brand.dev, Similarweb and cross-domain subsidiaries remain excluded.
  Native warnings and V2 audit issues explicitly disclose the limitation and the
  absence of verified external evidence. These warnings do not trigger retries.
  There is no general subsidiary/entity catalog; legal entities sharing
  one domain still require manual identity review. No name-based consolidation
  is performed and group/country claim scopes are preserved in V2.
- Companies without a reachable HTTPS exact host, domain-only leads and leads
  without a validated Apollo organization ID do not enroll. Verification proves
  reachable exact-domain public evidence, not legal ownership of the domain.
- Failure of required fetch/search/extraction fails closed, releases the lease
  and does not silently fall back to personalized company searches. No negative
  cache or partial extraction checkpoint is implemented.
- No real-provider quality comparison, paid replay, production RLS/auth-helper
  execution, multi-session SQL concurrency test or deployed browser audit was
  performed. These remain explicit rollout validation gaps, not claimed passes.

## Changed Surfaces

New files: public company contracts, adapters, server collector/store, server
validation, cache tests, SQL migration, embedded SQL test and this document.
Integrated files: native research/person collection and contracts, snapshot/V2
contracts, snapshot adapter, V2 gather/checkpoint/documents, synthesis provenance,
draft-context expiry, associated focused tests and the sanitized test runner.
Existing unrelated dirty changes were neither reverted nor committed. No UI
component was changed by this task.

## Focused Review Corrections (2026-09-09)

- Fixed enqueue eligibility: the former worker `requestedLead` already contained
  Apollo enrichment. Persist the original candidate or null before that boundary.
- Fixed canonical country navigation (`/chile`, not only `/chile/`).
- Added the bounded external complement to the same public artifact, with identical
  TTL, leases, raw-block origin validation, private-input isolation and per-report audit.
  Collector identity version is now `public-company/2:report-v2/p3-claims/4`; the
  Apollo organization ID is part of the identity to prevent same-domain collisions.
- Native claims preserve event dates and omit group/other-country assertions that
  V1 cannot scope safely; original public evidence and scoped V2 claims remain intact.
- Literal fetched quotes use rule provenance (model provenance remains on claims),
  so existing native evidence eligibility does not discard them. Shared signals
  count toward native recency only within the existing fourteen-day signal window.
- Graph validation rejects undated signals and event dates later than supporting
  retrieval times. Collection checks cancellation after extraction before publication.
- Closed SQL CHECK's nullable-expiry loophole in the unapplied migration.
- RLS/grants, tenant separation, stale-token rejection, failed refresh preservation,
  oldest-source TTL and owner-specific V2 merge/audit passed local focused checks.
- Review runs: 55, 78 and 91 passing tests respectively, with overlapping targeted
  reruns, not additive unique totals. The follow-ups cover SQL nullable expiry,
  persisted warnings, draft eligibility, recency, documents and owner-scoped workers.
  Node 22.23.2, sanitized unit environment, no env file required or loaded. No
  production operations were used.

Remaining rollout decision: the Apollo organization ID disambiguates known Apollo
organizations, but it is not independent proof of legal ownership of a domain. A
company group sharing one domain/country still needs provider-validated entity
semantics before promising subsidiary-specific reuse. This review does not invent
one from private contact data or claim full external-coverage parity.
