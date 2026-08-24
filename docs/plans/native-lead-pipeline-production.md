# Native Lead Pipeline Production Plan

## Purpose

This document is the durable execution record for replacing the fragmented lead
pipeline with one native production path. It is intentionally implementation
oriented so work can resume after context compaction, a handoff, or a restart.

Update the `Execution status` section whenever a phase is completed or a new
blocker is discovered. Do not remove completed items; keep the audit trail.

## Product Decision Record

- Lead search and enrichment provider: Apollo only.
- Web research provider: Serper.
- AI provider: OpenAI only, with configurable model tiers.
- Vane: retired from repository runtime configuration; remote secret revocation
  remains an operational follow-up.
- n8n: not a runtime dependency or rollback target; its public legacy endpoint
  returns `410 Gone`.
- Sending: manual review and durable approval are mandatory for every email.
- Product flow: Search -> Get contact details -> Research -> Draft -> Review ->
  Approve -> Send.

## Target Architecture

```text
Next.js App Hosting
  authenticated UI and command APIs
        |
        +-- Apollo backend App Hosting (internal service-to-service only)
        |     search, enrichment, provider callbacks
        |
        +-- Supabase
        |     durable runs, jobs, snapshots, drafts, dispatches, RLS
        |
Firebase scheduled functions
  workers, campaign processing, reconciliation, reply sync, rollups
        |
        +-- native research worker
              official site + Serper + OpenAI
```

## Non-Negotiable Invariants

1. The browser never owns the authoritative post-send history write.
2. A send requires an immutable approved draft version and the current version
   must still match at dispatch time.
3. Provider delivery is idempotent and every confirmed send has a server-side
   projection into contact history and email events.
4. All organization-scoped data has enforced RLS and server-only secrets.
5. Research evidence is tenant-scoped, provenance-backed, time-bounded, and
   separated from model hypotheses.
6. No automated email send is introduced by this work.
7. New schema work is forward-only. Never edit historical migrations to change
   production behavior.

## Execution Status

| Phase | State | Notes |
| --- | --- | --- |
| 0. Baseline and safety inventory | Partial | Local inventory is complete; remote topology and rollout approval remain. |
| 1. Security and production configuration | In progress | Forward-only RLS and App Hosting cleanup are local; remote verification remains. |
| 2. Apollo-only gateway | Implemented (route slice) | Apollo is enforced for lead search and enrichment routes; legacy PDL inputs normalize safely. |
| 3. Native research v2 | In progress | Durable batches, Serper, artifact leases, and quality foundation are local. |
| 4. Drafting and approval | In progress | Version approval exists; structured DraftContextV2 and fallback removal remain. |
| 5. Durable sending and replies | In progress | Approved-content boundary, history finalizer, campaign delivery/reply ingestion, and no-auto-send gates are local; remote migration and generic review completion remain. |
| 6. Product UX consolidation | In progress | Compose and enriched-list actions route to review/research; full review inbox and mobile visual QA remain. |
| 7. Scheduler and legacy retirement | In progress | Firebase ticks are hardened; legacy runtime config and public endpoints are retired locally. |
| 8. Verification and staged rollout | Pending | Tests, canary, observability, rollback rehearsal. |

## Implementation Checkpoint: 2026-08-22

Completed locally, pending review and deployment:

- `20260822121500_phase1_security_rls.sql`: forward-only RLS hardening for
  profiles, replies, saved searches, provider tokens, email events, and Axis
  tables.
- `20260822130000_finalize_sent_outbound_dispatch_history.sql`: service-role
  idempotent projection of sent dispatches into contact history and events.
- `20260822133000_research_company_artifacts.sql`: tenant-scoped company
  artifacts, expiration, revision identity, and generation leases.
- `src/lib/server/serper-search.ts`: server-only Serper adapter with bounded
  retries, localized queries, redacted errors, and tenant-safe cache identity.
- Root lead and enrichment routes normalize to Apollo-only behavior while the
  unused PDL implementation remains as compatibility material.
- Native sends rebuild their content from the approved persisted version and
  invoke the durable history finalizer.
- Firebase owns Antonia and native research ticks; the old App Hosting
  forwarding path is deprecated and manual triggers are IAM-private.
- Compose presents a durable review lifecycle without internal workflow terms.

Known residuals before deployment:

- Apply and verify new migrations/RLS policies against the remote schema.
- Configure Serper and distinct Firebase manual-trigger secrets in Secret
  Manager.
- Revoke or rotate retired Vane, n8n, GLM, and SerpAPI secrets in remote secret
  stores after confirming that no external caller still depends on them.
- Complete structured OpenAI dossier/drafting behavior and move research UI to
  persisted batch runs.
- Unify campaign deliveries and reply ingestion under the dispatch boundary.

## Implementation Checkpoint: 2026-08-23

Completed locally, pending review and deployment:

- Production `/api/providers/send` rejects browser-owned sends without a paired
  approved `draftId` and `versionId`; the legacy compatibility branch is limited
  to isolated test fixtures.
- Gmail and Outlook client facades no longer submit browser-owned recipient,
  subject, or body content. Compose requires an approved native draft and leaves
  contact history/quota finalization to the server dispatch path.
- Campaign cron runs are forced to dry-run. Antonia contact processing creates
  an approval-required exception before its retired contact-send branch.
- SUPL.IA email and reply-send tools now persist deterministic pending-review
  drafts and never refresh provider tokens, reserve contact quota, or invoke a
  provider. SUPL.IA bulk email returns review-required without iterating sends.
- System alerts and daily reports retain their internal records but no longer
  select member OAuth tokens or dispatch email automatically.
- Enriched lead/opportunity contact and bulk actions preserve selected lead IDs
  in the tab-scoped research handoff. The unreachable legacy planner scheduler
  was removed from enriched leads.
- Local verification after this checkpoint: `npm test` (449 passing),
  `npm run typecheck`, and `npm run lint` all pass.

Open operational blockers:

- Remote security audit found disabled RLS on core tables including `leads`,
  `enriched_leads`, `antonia_exceptions`, `organization_invitations`, and
  `organization_requests`, plus legacy import tables. Inventory effective grants
  and policies before applying narrow forward-only fixes.
- Review `SECURITY DEFINER` RPC grants and mutable search paths, especially
  contact/quota/scheduler RPCs. Do not enable RLS broadly without policy and
  authenticated regression tests.
- Configure and verify Firebase/App Hosting secrets, IAM invokers, Scheduler
  ownership, remote migration history, and a no-send research canary before any
  production rollout.
- Build a review inbox or explicit manual-delivery flow for system alerts and
  reports before offering email delivery again.

## Phase 0: Baseline and Safety Inventory

- [ ] Capture active deployment topology: App Hosting revisions, Firebase
  Functions, Cloud Scheduler, Vercel crons, Supabase migration history, IAM,
  and Secret Manager bindings.
- [ ] Identify active code paths before removing a legacy route.
- [ ] Keep all unrelated dirty worktree changes intact.
- [ ] Create a clean committed deployment revision before production rollout.
- [ ] Confirm provider credits and production budgets before real Apollo,
  Serper, or OpenAI execution.

Exit criteria:

- One known scheduler owner exists for each workload.
- No deployment depends on an untracked migration or secret.

## Phase 1: Security and Production Configuration

- [ ] Add a forward-only migration that fixes cross-tenant RLS for profiles,
  Axis tables, `lead_responses`, saved searches, provider tokens, and event
  writes.
- [x] Remove Vane runtime configuration. No Vane API route exists in this
  repository to retire.
- [ ] Require internal request authentication for all backend Apollo routes.
- [ ] Remove unsupported App Hosting `build.steps`; use the Next.js buildpack.
- [ ] Separate cron, worker, token-encryption, unsubscribe, tracking, and
  backend-internal secrets.
- [ ] Add a production configuration verifier for all required secrets and
  flags.
- [ ] Resolve the incompatible `lead_research_reports` schema as a legacy
  artifact; native code must not write to it.

Exit criteria:

- Remote RLS and policy tests prove organization isolation.
- Every expensive endpoint is authenticated, rate-limited, and auditable.

## Phase 2: Apollo-Only Gateway

- [ ] Keep `POST /api/leads/search` as the authenticated frontend BFF.
- [ ] Keep the backend service only as an authenticated Apollo adapter.
- [ ] Introduce neutral `/api/leads/enrich`; temporary Apollo-named routes
  delegate to it.
- [x] Remove PDL client selection, environment settings, and active product
  documentation after a compatibility release. Keep the rollback adapter and
  excluded App Hosting compatibility entries until their separate cleanup.
- [ ] Preserve daily quotas, idempotency, operation fingerprints, and provider
  usage events.
- [ ] Verify replays do not consume Apollo credits or create duplicate leads.

Exit criteria:

- Apollo is the only lead-data provider reachable by the application path.

## Phase 3: Native Research v2

### Persistence

- [ ] Add `research_runs` and `research_run_items` for request-level and
  per-lead progress.
- [ ] Add `research_company_artifacts` with a tenant-scoped cache identity,
  expiry, prompt/model versions, and generation lease.
- [ ] Reuse `lead_research_jobs`, `research_snapshots`, and atomic claims for
  execution and recovery.
- [ ] Add retention and safe refresh behavior. A refresh creates a new revision
  rather than overwriting history.

### Execution

- [ ] Accept batches of at most 50 leads; return per-item validation failures.
- [ ] Deduplicate company work by cache identity within a run.
- [ ] Fetch official sites with SSRF protection, bounded redirects, timeouts,
  and response limits.
- [ ] Use Serper for company LinkedIn, news, ICP signals, hiring, person
  LinkedIn, and person mentions.
- [ ] Normalize, deduplicate, rank, and date all sources.
- [ ] Generate structured research plans, company dossiers, and person dossiers
  with strict Zod schemas.
- [ ] Use a higher OpenAI tier only for incomplete identity, angle, or evidence.
- [ ] Persist evidence separately from hypotheses and require verified URLs for
  scored claims.

### Rules

- [ ] Score ICP, offer fit, buying signals, decision power, evidence quality,
  and identity risk deterministically.
- [ ] Cap insufficient research at 40 and block generic drafting.
- [ ] Make `maxContactosPorEmpresa` a hard drafting exclusion.
- [ ] Use tenant, seller profile revision, ICP hash, country, prompt version,
  and provider version in cache identity.

Exit criteria:

- Each research item is resumable, evidence-backed, and independent of n8n.

## Phase 4: Drafting and Approval

- [ ] Replace text-only prompt packs with a structured `DraftContextV2` built
  from a research snapshot.
- [ ] Use the server-backed writing style as the sole source of truth.
- [ ] Priority A uses the OpenAI reasoning tier; B/C uses the balanced tier and
  tenant-scoped segment templates.
- [ ] Validate subject length, body length, prohibited phrases, placeholder
  tokens, one CTA, personalization provenance, source URLs, and duplicates.
- [ ] Permit one deterministic rewrite attempt only.
- [ ] Represent evidence-insufficient drafts as valid blocked results, not
  model-generation errors.
- [ ] Remove generic fallback drafts from the sendable path.
- [ ] Persist every edit as a new `messaging_draft_versions` revision with
  approval reset to pending.

Exit criteria:

- A ready draft is always immutable, approved, preflight-passed, and traceable
  to a research snapshot.

## Phase 5: Durable Sending and Replies

- [ ] Require `draftId` and `versionId` for all normal sends.
- [ ] Retire legacy-ready draft creation from the normal send path.
- [ ] Add a generic server-side dispatch finalization RPC for every confirmed
  send, replay, and reconciled send.
- [ ] Finalize dispatch, contact history, email event, lead state, campaign
  delivery state, and tracking identity atomically.
- [ ] Add `campaign_deliveries` and migrate away from `campaigns.sent_records`
  as the source of truth.
- [ ] Move all campaigns to the same dispatch boundary.
- [ ] Route Gmail, Outlook, webhook, and LinkedIn replies through one idempotent
  ingestion contract.
- [ ] Add cursor-based mailbox polling independent of campaign activity.

Exit criteria:

- A provider-confirmed email never relies on client code to appear in history.

## Phase 6: Product UX Consolidation

- [ ] Search: one primary action, clear selected lead state, no silent split
  between saved and enriched leads.
- [ ] Enrichment: focused dialog or mobile sheet, email default on, phone
  optional, cost shown only when material.
- [ ] Research: single workspace with `Por investigar` and `Listos para
  redactar`; remove workflow/provider/internal terminology.
- [ ] Draft setup asks only for campaign objective; restrictions remain optional.
- [ ] Compose becomes `Revisar correo` with evidence, readiness, explicit
  approval, and a final send confirmation.
- [ ] Remove bulk `Enviar todos` and require review per recipient.
- [ ] Email Studio uses one server-backed style editor; local style profiles are
  removed or migrated.
- [ ] Audit desktop/mobile, dark mode, loading, empty, error, keyboard, focus,
  and reduced-motion states.

Exit criteria:

- A first-time user can identify the next action in each stage within seconds.

## Phase 7: Scheduling and Legacy Retirement

- [ ] Firebase Functions owns research workers, campaigns, reconciliation,
  reply sync, Apollo usage capture, and rollups.
- [ ] Remove Vercel cron dependence and duplicate forwarding to HTTP ticks.
- [ ] Remove public worker invocation or implement OIDC-only invocation.
- [x] Disable n8n runtime configuration and return `410 Gone` from its public
  legacy route.
- [x] Disable Vane runtime configuration after the compatibility window.
- [ ] Keep legacy persisted data read-only until retention policy permits
  deletion.

Exit criteria:

- One scheduler owns each workload and no legacy provider receives traffic.

## Phase 8: Verification and Rollout

- [ ] Unit-test provider adapters, source normalization, scoring, angle
  assignment, drafting validation, and idempotency.
- [ ] Contract-test all native behavior against fixtures extracted from the two
  historical workflows.
- [ ] Integration-test claims, RLS, quotas, cache expiry, dispatch finalization,
  and reply ingestion locally.
- [ ] Run Playwright checks at 360, 390, 768, 1024, and 1440 pixels in light and
  dark themes.
- [ ] Deploy with flags disabled, then enable a per-organization allowlist.
- [ ] Canary 5-10 research leads without sends, then one controlled email.
- [ ] Monitor queue age, cache hit rate, provider calls, cost per run, quality
  blocks, approvals, dispatch finalization, and reply lag.
- [ ] Rehearse rollback: pause schedulers, disable flags, roll back app/function
  revisions, reconcile unknown dispatches, preserve additive database state.

## Current Work Order

1. Finish baseline alignment against the active worktree.
2. Land forward-only security/configuration and dispatch-finalization changes.
3. Consolidate the native research and drafting service layers.
4. Move the UI to the single product flow.
5. Complete remote secret revocation only after automated and staged validation.

## Completion Definition

- No runtime dependency on n8n, Vane, PDL, SerpAPI, or GLM.
- Apollo is the only lead-data provider.
- Serper and OpenAI are the only new research/drafting providers.
- There is one durable research path, one writing style source, and one send
  boundary.
- Every email has a versioned approval and provider-confirmed server-side
  history.
- Production security, scheduler ownership, observability, and rollback are
  verified.
