# Constanza Research Investigation

## Status

2026-09-09 reconciliation, incorporating the prior 13:47 UTC deployment and the
read-only review reported by the user: V2 is enabled for the requesting organization.
Constanza document `93dc2415-f0d6-45e4-a526-01a978a32ecf` is persisted as
completed/visible, with completed synthesis and its exact document pointer.
Owner-scoped application loaders and latest-lead lookup returned it; another
owner's read was denied. This is persisted/API delivery, not a browser assertion.

The 06:40 UTC Email Studio five-column blocker was subsequently resolved: the
prior review confirmed those columns and the atomic revision RPC available through
PostgREST, and the later `main` application rollout completed at 13:47 UTC.
Subsequent concurrent worktree changes are not thereby verified or deployed.
No authenticated browser check or new remote verification was made in this
documentation pass. See **Expanded Report Publication** and **Later Reconciliation**
below; the earlier investigation and release gates are historical.

Historical initial investigation: local fixes only on main, preserving the existing dirty worktree.
Production was read only through supabase-production (yfdelflsheurzaicwayi).
No deployment, configuration/data write, migration, paid provider request, cron
invocation, email, seed, production suite or commit was performed in this investigation.

## Persisted Evidence (Initial Investigation)

- Job `62e92755-7938-4802-ace2-8e15d9ee8e62`: native-research-v1, deep/es,
  Chile, created 04:56:20 UTC, completed 04:57:15 UTC, partial.
- Snapshot `0e0f8309-9972-52de-954b-05e01ee13289`: no public-company reference.
  Quality person=1, company=1, recentSignals=0, overallConfidence=0.85. These
  metrics are not report prose completeness or proof of new signals.
- Request contains the correct local enriched-lead ID, grupoexpro.com and
  companyWebsite=null; publicCompanyIdentity=null, no private Apollo context.
- Exact stored enriched-lead row is in the same organization but belongs to a
  DIFFERENT user. Its nested Apollo organization has ID
  `54a134b269702d2db411b800`, domain grupoexpro.com and website
  `http://www.grupoexpro.com`. The Apollo contact ID is different and is not a
  company identity. No name search was needed.
- Existing SELECT policies allow team members to read enriched leads and
  opportunities. Private Apollo context loading deliberately also filters user_id;
  that filter correctly excluded this other owner's row. No owner-scoped
  apollo_organization_contexts record matched the requester/domain.
- Legacy company artifact `26ae595e-504a-416d-a7d5-23f4402bfca5`: cache miss,
  expiry 2026-10-09, not the shared 24-hour public graph. Legacy company profile,
  news, hiring and mentions collectors reported unavailable results.
- No workflow settings row exists for this organization. The loader therefore
  resolves reportV2Mode to off, independently of SHARED_PUBLIC_COMPANY_RESEARCH_ENABLED.
- Only V1 synthesis state exists: two attempts, partial, prompt
  native-research-report-synthesis/v8. No V2 state, V2 document or V2 audit exists
  for this snapshot.
- Two V1 documents were persisted, both visible/model/gpt-5.6-luna/partial. The
  state points to `721ef9df-5c6b-4ac7-b1db-e60ee9a6fb81`, generated 04:59:01 UTC.
  It has only executiveSummary narrative; leadContext, companyProfile,
  commercialReading and serviceFit are empty. The first document at 04:57:20
  also had leadContext. The retry produced LESS prose, not a richer report.
- Document completeness is 0.625; company_market, company_scale and signals are
  missing. It retains fact/offer lists, which are not a full commercial narrative.
- GET /api/native-research/[reportId] reads the state's exact document pointer,
  returns no-store and prefers V2 only if a readable visible V2 document exists.
  Workspace parsing likewise prefers valid V2 and otherwise V1. Thus the stored
  result explains the old-looking report; there is no hidden completed V2 here.
  This is code/persistence tracing, not a captured authenticated browser session.
- The previous direct cache artifact is PE/standard/es. This request is CL/deep/es.
  No matching CL/deep/es public artifact was found. Even after the fix the first
  such request must collect cold, not claim a hit against the Peru artifact.

## Causal Chain

The enriched-row mapper read data.companyWebsite but ignored the persisted
data.organization.website_url. The workspace propagated the correct local ID and
domain, but a null website. Enqueue required that original website AND an Apollo
organization ID from the private owner-scoped loader. Both conditions failed for
this team lead. It persisted null enrollment and ran the old collector, whose
optional company searches were unavailable. Separately, V2 was off, so only V1
editorial synthesis ran and partially failed. Cache reuse and report quality are
different concerns; the previous successful direct cache test validated neither
this enrollment path nor the report delivered to the user.

V1 discards section failure details and stores only report_synthesis_partial.
The narrow event-ledger lookup found no matching job/snapshot telemetry in the
generation window. The available MCP exposes no runtime log/advisory tool. The
exact section failures (request/provider/timeout versus validation) and original
HTTP causes of the optional search warnings cannot be recovered from these rows.
Do not attribute them to the earlier Serper HTTP 400 without runtime evidence.

## Local Changes

- apollo-research-context.ts: new server-side public company identity loader.
  Owner-scoped context stays private. Team fallback requires current membership,
  exact record ID, exact tenant and Apollo provider; projects only company ID,
  domains and website, not the other owner's contact, seller or report data.
  Conflicting stored/nested/request domains, websites and duplicate organization
  identities fail closed. No name, email-domain or contact-ID inference.
- native-research.ts: enrolls from that server-derived identity despite a missing
  client website; persists enrollment once. Worker revalidates the complete
  identity before shared collection. Old null-enrollment jobs are not silently
  migrated, and mismatches cannot fall back to a different company.
- enriched-leads-service.ts: preserves the nested Apollo website in the actual
  caller mapping, without changing the local lead ID.
- research-report-worker.ts: when mode is visible, rejects pending V1 retries
  before seller/model calls. New native work already bypasses V1 in visible mode;
  shadow intentionally retains V1. This does not activate or auto-enqueue V2.
- Regression tests execute the original missing-field/team-owner shape, actual
  row mapping, scoped query filters, membership denial, changed employer/domain,
  conflicting IDs, database failure, owner hydration and visible-mode queue cost
  guard. Existing structural wiring assertions were updated too; they are not
  the sole regression coverage.

## Verification

- Node 22.23.2; nine focused files passed 79 tests. Added an additional identity
  case and reran only affected Apollo files: 11/11 passing. A final domain-change
  guard rerun passed those same 11 tests. Counts overlap, not additive totals.
- Suites use the sanitized run-node-tests.mjs environment, with no env file,
  provider credentials or production access. The client mapper import reports
  missing Supabase variables as expected; all database behavior is mocked.
- Final npm run build passed, followed sequentially by npm run typecheck.
  Next build loads its existing .env.local; this is NOT a test-suite env and
  does not verify production configuration. No application endpoints were invoked.
- git diff --check passed (existing Windows line-ending notices only).
- No browser audit or real model evaluation was performed. Local tests prove
  routing/identity/contracts, not richer generated prose or actual savings.

## Proposed Release Gates (Historical)

These were the initial gates, not the current rollout state. The authorized
evaluation, organization-only activation, publication and later application rollout
are recorded below. Fresh deployed queue-to-browser and runtime checks remain open.

1. Obtain explicit approval for a code-only deployment from main to App Hosting
   studio/leadflowai-3yjcy. Review the complete dirty deployment diff, not just this
   task's files; retain reportV2Mode=off and the existing shared-cache flag. No
   migration is needed by these fixes. Do not deploy unrelated changes implicitly.
2. Confirm the deployed revision, auth/member-scoped identity lookup and worker
   lifetime/configuration. Code schedules nativeResearchTick every minute with a
   540-second Functions timeout and one V2 attempt per queue invocation. Verify
   actual App Hosting request lifetime and overlapping tick behavior; a successful
   health endpoint alone is not a report validation gate.
3. Separately authorize a bounded paid V2 evaluation for the actual Constanza
   CL/deep/es input and current seller context, saving the output privately before
   any visibility change. Inspect complete company/contact/offer prose, individual
   pilots and metrics, citations, dated signals or explicit absence, and the
   distinction between group headcount and Chile-specific scale. Require no
   blocking factual/seller audit issues; do not accept an audit score alone.
4. Only after report review and another explicit approval, create/configure the
   currently missing workflow settings for organization
   e73dd11f-c8db-4ffc-9711-47dc74295064 with research_config.reportV2Mode=visible.
   Validate the real table defaults, seller/ICP values and pending queue before
   preparing that write. This is organization-wide, not a per-user canary: agree
   a bounded test window and budget first. Do not enable globally. Shadow is not
   free and cannot be promoted merely by reusing its context hash.
5. Within that approved window, submit a NEW authenticated UI request for Constanza
   and one authorized second lead with identical company identity/CL/deep/es.
   Verify persisted enrollment, a CL cold artifact then warm reuse within TTL,
   zero warm company search/fetch/extraction calls, distinct owner/lead reports,
   and zero V1 synthesis for visible-mode new work. Expect private person research
   and per-report analysis/writing/audit costs on both runs.
6. Follow each synthesis state to its exact visible V2 document ID and verify the
   actual browser renders that same report and citations. Check refresh, loading,
   failures, mobile/light/dark and no exposure to other owners/tenants. No email or
   draft send. Stop on mismatched identity, duplicate company spend, incomplete
   core prose, blocking audit or timeout; no automatic extra paid retries.
7. Approve wider use only after that end-to-end result. Preserve the historical
   V1 snapshot/documents; no backfill is authorized. An authorized rollback can
   stop new V2 generation via mode off and new shared enrollment via its flag,
   but off is NOT a revocation of already-visible documents and enrolled identities
   remain honored. Do not delete artifacts or improvise delivery-state mutations.

## Authorized Deployment and Evaluation

2026-09-09 UTC. Explicit continuation approval covered deployment of the existing
local fixes and a bounded paid evaluation, not organization-wide V2 activation.
All pre-existing changes on `main` were preserved; no commit or application-code
edit was made in this continuation. Operational scripts and raw artifacts are
outside the repository. The applied migration `20260909034401` was verified and
neither edited nor reapplied.

### Deployment

- Node 22.23.2. `npm run build` passed, then `npm run typecheck` passed sequentially.
  Build loaded the existing `.env.local`; neither operational generation nor any
  test suite loaded that file. Previously passing proportional suites were not
  repeated because application code was unchanged. `git diff --check` passed.
- `firebase deploy --only apphosting -P leadflowai-3yjcy` completed successfully,
  including the rollout, not just upload. Source archive:
  `gs://firebaseapphosting-sources-1083965020353-us-central1/studio--54828-U7vI6EyQykO4-.zip`.
  This is a dirty-main deployment based on `ae247ec`, not a new Git commit.
- Backend `studio` subsequently reported `updateTime=2026-09-09T05:37:55.698001Z`
  and `reconciling=false`; URL remains
  `https://studio--leadflowai-3yjcy.us-central1.hosted.app`.
  The login HTTP page was reachable; this is not an authenticated browser audit.
- Cloud Run revision/traffic/request-timeout and runtime error-log reads were
  attempted through gcloud but failed because its credentials require interactive
  reauthentication. Firebase deployment authentication worked. Do not infer the
  Cloud Run revision name, error-free logs or queue lifetime from the deploy result.
  No Functions deployment, scheduler invocation or queue drain was performed.

### Exact Target and Real Research

- Job owner is `de3a3194-29b1-449a-828a-53608a7ebe47`; local enriched lead
  `dfe72b50-e617-42f1-9fa5-aec32ce0687d` belongs to
  `05181690-126e-48ca-ba49-6536565dca43` in the same organization. The corrected
  production-backed server identity loader succeeded with the original missing
  website. It did not import the other owner's private Apollo context.
- The operation used the exact requester-scoped job input, a fresh person search,
  current requester seller configuration (Yago), and the actual public company
  collector/store/adapter. The organization still has no workflow settings row;
  mode resolves to off and ICP rules are absent. No other lead was generated.
- Correct cache identity: Apollo `54a134b269702d2db411b800`, `grupoexpro.com`,
  `CL/deep/es`, version `public-company/2:report-v2/p3-claims/4`.
- Cold production artifact `75089487-6b35-4823-84ea-2f31e2782464`, revision 1:
  3 searches, 6 fetched official pages, 2 extraction batches, 6 successful model
  calls, 42,937 ms. Graph: 116 raw facts and 30 company claims. No external company
  source passed the bounded evidence filter. The parser printed CSS warnings but
  collection, origin validation and cache completion succeeded.
- Capture `2026-09-09T05:41:06.374Z`, expiry `2026-09-10T05:41:06.374Z`.
  Immediate MCP SQL independently confirmed identity, revision, counts, released
  lease and RLS still enabled. The existing PE/standard artifact was not reused.
- Fresh private person research used 1 search, 1,346 ms, retaining 2 TheOrg search
  results. They are discovery snippets, not independently fetched verified profiles.
- A new local native snapshot `1d0e5915-7d65-5451-a92c-786ee54f8c71` was built
  through the native snapshot builder. `gatherReportV2Research` then loaded its
  shared reference through the real store: **hit, 214 ms, 0 queries, 0 pages,
  0 extraction batches**, with a guard that would throw on any cold collection.
  Final projection: 8 sources, 118 facts, 32 claims. Shared company evidence and
  current private person context were merged, not replayed from historical V1.
- Only after that fresh integrated collection did `review-report-v2.ts --replay`
  perform editorial synthesis. Its zero research counters describe the warm merge,
  not the cold collection. `operation.json` records the complete research path.
  This proves server-module/cache integration against production, NOT deployed
  HTTP enrollment, durable report publication or queue-to-browser behavior.

### Report, Audit and Cost

Artifact root:
`C:\Users\nicol\AppData\Local\Temp\opencode\constanza-v2-live-3f4aec3b-5ce9-4364-a6f2-c9192dd97bce`.

- Reviewed report: `review\report.md`; structured document: `review\result.json`.
  Local document ID `report-v2:b4e856e30f6acb6a5430fc86`, revision 1.
  This ID is not a persisted production report row.
- One synthesis, four successful editorial calls, no targeted repair needed by
  the auditor, 71 seconds. Model for extraction, specialists, analyst, editor and
  audit: `gpt-5.6-luna`. No second paid synthesis or automatic retry was launched.
- Status `completed`, six of six core prose fields filled. There are also six
  discovery questions and substantive risk prose. Optional signals, regulatory,
  volume, snapshot and gaps sections have no narrative; completion is not proof
  of comprehensive evidence coverage.
- AI audit: no blocking sections; one literal-copy warning for the exact job title
  `Professional Talent Acquisition`. Final report also carries two company-source
  coverage warnings. The audit received all 32 claims and all 118 raw facts, not
  only cited facts. `review\audit-1.json` preserves the raw result.
- Manual review: company activity and Chile coverage are cited, while group facts
  remain labeled GLOBAL/group. The imported 12,000 figure is not promoted into
  Chile headcount or a volume model. Role is treated as operational influence, not
  budget authority. Three recruiting-specific pilots each have separate measures:
  CV review minutes/candidate; query response time and referral percentage; file
  preparation time and first-submission completeness. Proposed baselines are not
  fabricated measurements. Seller capabilities match the current Yago profile;
  no invented customers, existing conversations, savings or seller traction found.
- Limits: zero dated signals; no verified Chile headcount, legal entity, buying
  authority or confirmed buying initiative. Absence of urgency and missing ICP
  are explicit in the structured analyst blockers but not adequately surfaced in
  final prose. The company-only external-evidence warning is overbroad alongside
  two private TheOrg sources. Some recommendation citations are decorative: c31/
  c32 support the role, not the privacy assertions. Discovery wording presupposes
  some manual work. The structured analyst channel contains a stray non-Spanish
  fragment, although the final report opening does not. These are retained for
  review, not silently edited out or represented as fully clean automatic output.
- Successful company extraction usage: 13,969 input / 3,698 output tokens.
  Editorial usage: 31,095 input / 6,638 output. Total: **45,064 input + 10,336 output
  = 55,400 tokens across 10 successful calls**. Batch count is not model-call count.
- Internal-rate estimates: company USD 0.00792895; editorial USD 0.01573875;
  total USD 0.02366770. Assumptions: USD 0.20/M input, USD 1.20/M output,
  cache-read x0.1, cache-write x1.25 using recorded usage. NOT an official bill;
  excludes 4 Serper searches, hosting, failed calls and billing adjustments.

### Preservation and Remaining Approval (Before Publication)

- The operational script only wrote the exact CL/deep company cache via its
  existing RPCs. No production job, snapshot, document, seller/ICP/config, draft or
  delivery write; no emails or broad cron/queue processing. Raw inputs, telemetry,
  source graph, company reference, person evidence and all editorial outputs remain
  private outside Git. `review\result.json`'s zero-production-writes field applies
  only to editorial replay; the parent operation DID create the public cache.
- Production is not frozen: final read found four historical V1 documents, including
  additional attempts at 05:05:20 and 05:36:02 UTC. Both precede rollout completion;
  the latter appeared during this continuation, outside the isolated operation.
  The exact current V1 state has attemptCount=4 and pointer
  `7e6df9b9-0443-456b-a5cc-b986479bb075`, still partial. Original document
  `721ef9df-5c6b-4ac7-b1db-e60ee9a6fb81` remains preserved. No cause is attributed
  without runtime logs; mode off still intentionally permits V1 behavior.
- At this pre-publication stage, V2 was **not published for UI delivery**. No workflow settings row was created and no
  historical V1 was overwritten. This is a useful reviewed candidate, not approval
  for organization-wide automatic delivery. Separate user approval is still required
   for mode visible, with the remaining runtime/UI and quality gates above.

## Expanded Report Publication

Explicit user authorization now covers production publication and organization-only
visible rollout. On resumption, `antonia_workflow_settings.research_config` already
contained `reportV2Mode=visible` for `e73dd11f-c8db-4ffc-9711-47dc74295064`.
Membership lookup confirmed requester `de3a3194-29b1-449a-828a-53608a7ebe47` is an
admin of that organization. No other organization's configuration was changed.

- Reused the interrupted operation's `commercial-review/result.json`, generated
  at 06:01:32 UTC, after its bounded editorial repair. No further paid generation,
  search, email, cron, broad queue processing or migration was invoked.
- The expanded prose covers company activity/geography, contact and probable buying
  roles, exploratory company/contact fit, timing, three recruiting pilots with
  distinct baseline metrics, a neutral opening and six discovery questions.
  Unavailable scale, ticket, conversion, buying authority and recent triggers are
  explicit. No precise invented probabilities, named customers or success stories.
  Source links are separate from narrative; factual support remains inspectable.
- Independent editorial audit has zero issues; final document retains two source
  coverage warnings. The report is useful preparation, not complete verification
  of every checklist input. B2B classification remains overly conservative, and
  private email/phone are not enriched into the public graph.
- New job `a7ee8bf3-10a8-49c4-87ec-869292ba042c`, report
  `native:a7ee8bf3-10a8-49c4-87ec-869292ba042c`, snapshot
  `1d0e5915-7d65-5451-a92c-786ee54f8c71`, document
  `93dc2415-f0d6-45e4-a526-01a978a32ecf` were published at 06:24:31 UTC.
  Runtime `report-v2/runtime/1:f415bfa10f0924f0`, document completed/visible,
  synthesis completed with attemptCount=1 and its exact document pointer.
- Publication uses the reviewed native snapshot and application claim/persistence
  RPC, then a new native job. Original V1 job, snapshot and documents are untouched.
  Exact application document/job/latest-status loaders returned the new report;
  another user's document read was denied. MCP SQL independently confirmed the
  stored document and state pointer. This is not a fresh deployed queue run or
  an authenticated browser validation.
- Private publication receipt: `commercial-review/publication.json` under the
  artifact root above. New spending in this resumption: zero model/search calls.
  Prior failed editorial request billing is unknown; no new total cost is claimed.
- Node 22: 56 focused research/editor/security/publication tests passed. A further
  UI/native-draft run passed 28/29; the failure expects `body_structure`, removed
  by concurrent draft changes. Only the fixture's stale prompt version was updated
  to the canonical version constant. No production suite was run.
- Final build and sequential typecheck passed. Tests use the sanitized runner;
  build alone loads existing `.env.local`. Two earlier build failures in actively
  changing email files resolved through concurrent edits, not overwritten here.
- Historical deployment blocker at the 06:40 UTC follow-up: concurrent `email-style-profiles.ts` selected
  `library_scope`, `archived_at`, `source_collection`, `published_by`, `published_at`.
  Production information_schema showed all five absent at that time. Deploying
  that main worktree would have broken style queries. The unrelated migration
  `20260909120000_email_template_library.sql` had NOT yet been applied. No new
  Firebase deployment was attempted in that publication step; its latest confirmed
  deployment was the 05:37 rollout. This blocker is superseded below.

## Later Reconciliation

The subsequent outreach deployment record reports production versions
`20260909131929` (email_template_library) and `20260909132044`
(atomic_native_draft_revision) applied individually with authorization. The prior
review reported by the user confirmed all five columns and the RPC through
PostgREST. Application rollout from `main` completed at 2026-09-09 13:47 UTC;
the recorded health endpoint returned `ok: true` and login responded. These facts
supersede the early schema/deployment blocker, not the outstanding authenticated
browser, light/dark/mobile, runtime-log or fresh deployed queue checks.

The later parent-confirmed production SQL comparison allowed the local public-company
migration to be renamed from `20260908190000` to `20260909034401` without changing
its SQL. Report V2 foundation already matches production timestamp `20260908173355`.
EmailStudio/drafts timestamp reconciliation remains pending coordinated SQL comparison.
See [Migration History Reconciliation](migration-history-reconciliation.md) for proof
and scope. No SQL was applied or repaired, no deployment was performed, and concurrent
EmailStudio/drafts/research UI work was left untouched.
