# Campaign Outreach V2 Implementation Plan

## Status

**Status:** Local implementation completed for the initial-contact Campaign V2
slice. The migration is not applied and the feature flag remains disabled.

This document is a durable handoff for an implementation agent. It describes
the target product behavior, technical boundaries, data model, rollout order,
and acceptance criteria for campaign outreach v2.

Update the `Execution status` section as phases are completed. Do not remove
completed items or known risks; this document is also the audit trail for the
rollout.

## Relationship To Existing Plans

This plan extends, but does not replace:

- `docs/plans/native-lead-pipeline-production.md`
- `docs/native-research-report-delivery-plan.md`
- `docs/research-messaging-architecture.md`
- `docs/ui-ux/*`

The existing research -> native draft -> approval -> provider dispatch boundary
remains authoritative. This work must not introduce automatic email delivery.

## Product Decision Record

1. The default product journey is:

   ```text
   Prospect -> Saved lead -> Enriched lead -> Research -> Initial email
   -> Human review -> Send -> Follow-up workflow -> Campaign CRM
   ```

2. Initial-contact follow-up plans are created from the initial-email compose
   experience, not from the legacy campaign creation form.

3. A follow-up is a continuation for one person and one commercial thread.
   A re-engagement campaign is a new reason to contact one or more people.
   These concepts must have separate product names and entry points.

4. Every normal email requires an approved native draft and an explicit human
   send action. "Activate campaign" means create or expose review work; it
   never means automatic provider delivery.

5. Campaign audiences can contain every organization-visible lead with a
   usable email address. A lead may be selectable while still requiring
   research or another prerequisite before a personalized draft can be made.

6. Fixed audiences are the default. Dynamic audiences are an advanced mode
   that appends newly eligible contacts to a review queue; they never send
   automatically and never silently re-enroll prior recipients.

7. AI can draft, rewrite, add, remove, and reorder unsent sequence steps.
   It must preserve research provenance, create a new content version, and
   invalidate previous approval whenever content changes.

8. Campaign v2 is additive. Legacy `campaigns`, `campaign_steps`,
   `campaign_deliveries`, and `sent_records` remain readable while v2 is
   rolled out behind a feature flag.

9. The current campaign cron must not be enabled by removing `dryRun`. Its
   legacy live branch creates auto-approved draft records and does not meet
   the native review boundary required by this product.

## Product Vocabulary

| Term | Meaning | Must not be confused with |
| --- | --- | --- |
| Initial contact | First approved email sent to one lead for a specific reason. | A bulk campaign. |
| Follow-up plan | Personal sequence that continues an initial contact or thread. | Re-engagement. |
| Re-engagement campaign | New commercial reason to contact a selected audience. | A follow-up to an earlier email. |
| Audience | The people eligible or selected for a re-engagement campaign. | A text description for AI. |
| Enrollment | The durable relationship between a campaign and one recipient. | An outbound delivery attempt. |
| Sequence version | Immutable ordered definition of unsent campaign steps. | A message draft revision. |
| Recipient step | One planned message for one enrollment. | A generic sequence template step. |
| Review queue | Recipient steps that are due and require a human-approved draft. | A sending queue. |

Use the following product language consistently:

- Use `Anadir seguimiento` after an initial email.
- Use `Nueva razon para contactar` for re-engagement campaigns.
- Use `Listo para revisar`, not `Listo para enviar`, until a person approves a
  specific native draft.
- Use `Campanas` as the operational CRM area. Do not call a personal
  follow-up a new campaign in the UI.

## Goals

- Make the next commercial action obvious at every lead stage.
- Let users build a follow-up plan while they already have the lead report,
  message context, and email editor open.
- Give users conversational AI control over initial emails and every unsent
  sequence step.
- Show campaign progress as a truthful recipient-level CRM flow.
- Make re-engagement campaigns fast to create with direct audience selection,
  fixed audience snapshots, and report-aware personalization.
- Preserve tenant isolation, suppression controls, human approval, provider
  idempotency, and immutable delivery history.

## Non-Goals

- Do not add automatic outbound sending.
- Do not turn email opens or clicks into automatic sends, stage changes, or
  claims of intent.
- Do not replace the native draft approval boundary with browser-owned email
  content.
- Do not rewrite legacy campaign history or fabricate enrollments for records
  without auditable provenance.
- Do not make `contacted_leads` the sole audience source. It represents
  contact history, not every usable lead.
- Do not make all recipients share one mutable email body. Every recipient
  draft remains recipient-specific and versioned.

## Existing Implementation Inventory

### Lead and research flow

Current useful behavior:

```text
Search / saved leads
  -> enrichment
  -> enriched leads
  -> native research status and report
  -> POST /api/native-drafts
  -> /contact/compose?draftId=...
  -> review, approval, provider dispatch
  -> contacted_leads projection and commercial timeline
```

Important existing files:

- `src/app/(app)/saved/leads/page.tsx`
- `src/app/(app)/saved/leads/enriched/Client.tsx`
- `src/components/research/ResearchWorkspace.tsx`
- `src/components/research/NativeResearchReport.tsx`
- `src/app/(app)/research/page.tsx`
- `src/app/(app)/contact/compose/page.tsx`
- `src/app/api/native-drafts/route.ts`
- `src/app/api/native-drafts/[draftId]/rewrite/route.ts`
- `src/lib/server/native-drafts.ts`
- `src/ai/flows/generate-outreach-from-report.ts`

Current integration points to preserve:

- Enriched leads already create a native draft only after valid research and
  draft eligibility checks.
- Compose already exposes an AI rewrite instruction, style profile selection,
  native draft revision handling, preflight, approval, and explicit send.
- `MessagingDraftV1` requires a recipient-specific approved current revision
  before sending.
- `/api/providers/send` returns a durable dispatch receipt, including
  `receipt.dispatchId`, but current compose client facades do not expose that
  value to the product flow after send.
- `/research` currently redirects to `/saved/leads/enriched`; phase 1 should
  turn research into a real workspace instead of relying on that redirect.

### Current campaign implementation

Important existing files:

- `src/app/(app)/campaigns/page.tsx`
- `src/components/campaigns/CampaignFlow.tsx`
- `src/components/campaigns/CampaignAnalytics.tsx`
- `src/lib/campaign-settings.ts`
- `src/lib/campaign-eligibility.ts`
- `src/lib/services/campaigns-service.ts`
- `src/app/api/cron/process-campaigns/route.ts`
- `src/lib/server/campaign-deliveries.ts`
- `src/components/commercial/CommercialTimeline.tsx`
- `src/app/(app)/crm/page.tsx`

Known constraints:

- Legacy campaigns only support `follow_up` and `reconnection` behavior.
- The legacy campaign UI is based on inverse exclusions and technical
  reactivation switches instead of a positive recipient selection.
- Preview selection is temporary and does not persist as audience membership.
- Preview and cron eligibility do not currently resolve the same recipient set.
- Follow-up runtime requires campaign lineage from a contacted-lead record.
- The campaign cron is deliberately hard-coded to `dryRun = true`.
- Legacy campaign updates delete and recreate all `campaign_steps`, which is
  unsafe as a model for sequence history once recipients have progressed.
- `campaign_deliveries` is the durable delivery projection, but it cannot
  represent an enrolled recipient that is waiting, due, blocked, or awaiting
  human review before a dispatch exists.

### Current CRM implementation

- `src/app/(app)/crm/page.tsx` provides a broad pipeline Kanban.
- `src/components/commercial/CommercialTimeline.tsx` provides a useful
  recipient-level historical timeline.
- `CampaignFlow` is suitable for displaying the campaign template sequence,
  but not as a full-width flow repeated for every recipient.

## Target Information Architecture

Keep the current routes operational during the transition. Add v2 surfaces
behind a feature flag before replacing legacy navigation.

| Product area | Primary role | Primary action |
| --- | --- | --- |
| Leads | Find, enrich, research, and prepare people for outreach. | Contextual next action. |
| Initial email compose | Create, revise, approve, and send one first email. | `Enviar correo`. |
| Campaigns | Review follow-up work and campaign recipient progress. | `Revisar correos listos`. |
| Campaigns > New reason | Create a re-engagement campaign for an audience. | `Nueva razon para contactar`. |
| CRM | Manage commercial stage and broad lead ownership. | Contextual per-lead action. |

Suggested v2 routes:

```text
/campaigns                         Campaign review inbox and campaign list
/campaigns/[campaignId]            Campaign CRM detail
/campaigns/new/reengagement        Re-engagement builder
/campaigns/[campaignId]/audience   Audience editing and audit view
```

Do not add a separate top-level route solely for personal follow-up creation.
That action belongs to the compose experience and links to the campaign detail
after the initial email is confirmed sent.

## Target User Journeys

### Journey A: Lead to initial email and personal follow-up

1. The user prospects and saves a lead.
2. The user enriches the lead until a usable email is available.
3. The user runs or opens native research from the enriched-leads workspace.
4. The report presents verified facts, hypotheses, source access, research
   readiness, and one contextual CTA: `Crear borrador y revisar`.
5. The native draft opens in compose using the report snapshot.
6. The user writes manually or asks AI to adjust the initial email.
7. The user optionally opens `Anadir seguimiento` and asks AI to propose a
   personal sequence.
8. The user edits timing, removes or adds unsent steps, and saves a follow-up
   plan. This creates a draft campaign v2 and one enrollment in
   `pending_initial_send` state.
9. The user approves the initial native draft and explicitly sends it.
10. Server-side dispatch finalization records history, associates the initial
    recipient step with the resulting contact, and transitions the enrollment
    to `active` or `waiting_due`.
11. When a later step becomes due, it appears in Campaigns as `Listo para
    revisar`. The user opens a new recipient-specific native draft, optionally
    adjusts it with AI, approves it, and sends it.
12. A reply, unsubscribe, bounce, manual stop, or policy block stops all
    remaining unsent steps.

### Journey B: Campaign CRM

1. The user opens Campaigns.
2. The default view is a review inbox sorted by the next human action:
   replies, due drafts, deferred sends, and blocked recipients.
3. The user opens a campaign detail page.
4. The recipient table shows a compact step flow and an unambiguous status for
   every person.
5. The user filters by `Listos para revisar`, `Esperando`, `Respondieron`,
   `Detenidos`, `Completados`, and `Legado`.
6. Opening a recipient drawer shows research, the exact messages and versions,
   commercial timeline, delivery state, stop reason, and next action.

### Journey C: New reason to contact

1. The user opens `Campanas -> Nueva razon para contactar`.
2. The user describes what changed, the offer, preferred style, and CTA.
3. The user selects the audience directly from all usable-email lead sources.
4. The user chooses `Lista fija` by default, or explicitly opens advanced
   controls to choose `Audiencia dinamica`.
5. The user sees selected, ready, needs-research, and blocked counts.
6. AI proposes a sequence strategy and editable base steps.
7. The user reviews the audience, strategy, and sequence version.
8. Activating the campaign creates review work for eligible recipients. It does
   not send emails.
9. Each recipient message is generated from its own report snapshot and the
   approved sequence strategy when it is ready for review.

## UX Specification

### Leads workspace

The user should not need to infer where a lead lives after moving between
saved, enriched, researched, and contacted states. Phase 1 may retain current
storage tables and routes, but the visual model must expose a single lead
workspace with tabs or views:

- `Por enriquecer`
- `Por investigar`
- `Listos para redactar`
- `En seguimiento`

Show one meaningful next action per row:

| Lead condition | Row action |
| --- | --- |
| No usable email | `Obtener email` |
| Email but no valid research | `Investigar` |
| Valid research and no draft | `Crear borrador` |
| Draft needs review | `Revisar correo` |
| First email sent with plan | `Ver seguimiento` |
| Suppressed or bounced | `Ver motivo` |

Do not hide blocked records. Keep them visible with a textual reason.

### Compose with follow-up plan

Extend `src/app/(app)/contact/compose/page.tsx`; do not replace its current
native-draft review lifecycle.

Desktop layout:

```text
Header: lead identity, provider, draft/review status

Main column: subject and email editor
Right rail: report context, style, conversational AI, follow-up plan
Sticky footer: current single primary action
```

The follow-up plan is a collapsed section by default for an initial contact:

```text
Anadir seguimiento
  [No follow-up] [Proponer 2 seguimientos]
  Strategy summary
  Initial email -> wait -> Follow-up 1 -> wait -> Follow-up 2
  Edit sequence
```

Suggested default plan:

```text
Initial email
  -> wait 3 days
Follow-up 1
  -> wait 4 days
Follow-up 2 / close-the-loop
```

Defaults are suggestions, not hidden automation. Users can edit every timing
and content instruction before saving the plan. Treat offsets as calendar days
in v2's first release; add business-day semantics only with an explicit
calendar and timezone policy.

### Conversational AI editor

Evolve the existing `Ajustar con IA` control into a bounded, task-focused
conversation. It should support scope selection:

- `Este correo`
- `Este paso de seguimiento`
- `Todos los pasos no enviados`
- `Anadir un paso`
- `Cambiar estrategia de secuencia`

Example user requests:

```text
Hazlo mas breve y mas directo.
Mantiene el tono consultivo, pero cambia el CTA.
Agrega un seguimiento cinco dias despues si no hay respuesta.
Reescribe los pasos pendientes para este nuevo estilo.
No menciones la hipotesis como si fuera un hecho.
```

AI response requirements:

- Return a structured proposal, not an unreviewed direct mutation.
- Show a concise change summary and a per-step diff before applying it.
- Use only research evidence authorized by the recipient's `DraftContextV2`.
- Treat hypotheses as hedged language; never convert them into factual claims.
- Preserve the campaign purpose, sender style, recipient, and approved CTA
  constraints unless the user explicitly changes allowed fields.
- Create a new draft or sequence version when the proposal is accepted.
- Never alter a sent message, a past step, or an already-finalized delivery.
- Reset approval for any affected unsent native draft revision.

For re-engagement campaigns, AI first produces a sequence strategy and base
step instructions. It does not create one shared sendable email. A concrete
recipient-specific draft is later created from the recipient report, strategy,
step instructions, and current safe context.

### Campaign CRM detail

Use an operational list as the default. Do not default to a dense Kanban or a
dashboard full of metric cards.

Header content:

- Campaign name and type.
- Lifecycle state.
- Audience count.
- Current sequence version.
- Next work count.
- One primary CTA: `Revisar N correos` when work exists.

Recipient table desktop columns:

| Column | Content |
| --- | --- |
| Recipient | Name, role, company, email. |
| Progress | Compact arrow sequence with past, current, and next step. |
| Next action | Review, wait date, response, stop reason, or completion. |
| Last activity | Delivery, reply, or event timestamp. |
| Actions | Open detail; stop future steps when allowed. |

Example compact flow:

```text
Initial email sent -> Waiting until Aug 28 -> Follow-up 1 ready -> Follow-up 2
```

Use text, icon, and state styling together. Do not communicate progress or a
block only with color.

Recipient drawer content:

- Current campaign status and exact stop reason.
- Research snapshot and report freshness.
- Sequence step history and content versions.
- Native draft and approval status for the actionable step.
- Existing `CommercialTimeline` projection.
- Manual stop or resume action when policy allows it.

On mobile, render each recipient as a vertically stacked row showing the past,
current, and next sequence states. Do not force horizontal table scrolling.

### Re-engagement builder

The builder is a separate four-step wizard.

1. `Motivo`
   - Campaign name.
   - What changed and why contact now.
   - Offer, value, CTA, and style.

2. `Audiencia`
   - Direct search, filters, and positive lead selection.
   - Fixed mode default.
   - Dynamic mode only under `Opciones avanzadas`.
   - Counts for selected, ready, needs research, and blocked recipients.

3. `Mensajes`
   - Sequence strategy and editable base steps.
   - AI conversation and style controls.
   - No per-recipient mass send preview pretending that all messages are ready.

4. `Revision`
   - Frozen audience snapshot or dynamic evaluation diff.
   - Sequence version.
   - Preconditions, exclusions, sender configuration, and review work count.
   - CTA: `Activar cola de revision`.

## Accessibility, Responsive, and Visual Requirements

- Follow the project's Apple-like visual direction: one primary action per
  surface, silent surfaces, clear hierarchy, and minimal decorative cards.
- Use existing UI primitives before introducing new primitives.
- Support light and dark mode for every new surface.
- Use visible labels for inputs, filters, and AI scope controls.
- Implement keyboard-accessible sequence editing, dialogs, sheets, and
  recipient selection.
- Use actual indeterminate checkbox state for partially selected visible rows.
- Announce stable audience and review counts with `aria-live="polite"`.
- Preserve focus when a drawer, sheet, dialog, or AI proposal is closed.
- Respect `prefers-reduced-motion` for flow transitions and streaming UI.
- Maintain at least 44px touch targets in mobile workflows.
- Do not allow page-level horizontal overflow at 320, 360, 390, 768, 1024, or
  1440px widths.
- Build skeleton, empty, error, retry, disabled, and stale-data states for all
  workspace queries.

## Non-Negotiable Safety Invariants

1. The browser never owns authoritative enrollment, history, or delivery-state
   writes after a provider send.
2. A send requires the current immutable approved native draft version.
3. Every content change creates a new revision and invalidates approval.
4. Every confirmed dispatch has an idempotent server-side projection into
   contact history and campaign recipient progress when applicable.
5. Unsubscribe, do-not-contact, invalid email, hard bounce, blocked domain,
   and organization privacy controls cannot be toggled off in campaign UI.
6. A reply, negative outcome, unsubscribe, bounce, or manual stop prevents all
   future recipient steps before draft preparation or sending.
7. Dynamic membership may append newly eligible recipients, but must never
   silently add someone directly to provider delivery.
8. Legacy campaigns remain behaviorally stable while v2 is feature-flagged.
9. New schema changes are forward-only migrations. Never edit historical
   migrations to change deployed behavior.

## Domain Model

### Campaign kinds

```ts
type CampaignProgramKind =
  | 'first_contact_follow_up'
  | 'reengagement'
  | 'legacy_follow_up'
  | 'legacy_reconnection';

type CampaignEngineVersion = 'legacy' | 'v2';

type CampaignLifecycleState =
  | 'draft'
  | 'in_review'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';
```

Keep the existing `campaigns.status` contract (`active` and `paused`) stable
until every legacy caller is migrated. Store v2 state in additive columns or a
v2-specific projection; do not overload legacy status values.

### Audience mode

```ts
type CampaignAudienceMode = 'fixed' | 'dynamic';

type CampaignAudienceDefinitionV2 = {
  mode: CampaignAudienceMode;
  sourceKinds: Array<'lead' | 'enriched_lead' | 'contacted_lead' | 'people_search_lead'>;
  filters: CampaignAudienceFiltersV2;
  lastEvaluatedAt: string | null;
  lastEvaluationFingerprint: string | null;
};
```

For a fixed audience, the user selection is persisted as enrollment rows. For a
dynamic audience, the definition is persisted and each evaluation appends new
eligible enrollment rows. Do not remove existing enrollment history when a
person stops matching future dynamic filters.

### Normalized audience candidate

```ts
type AudienceCandidateV2 = {
  recipientKey: string; // `email:${normalizedEmail}` within an organization.
  normalizedEmail: string;
  displayEmail: string;
  name: string | null;
  title: string | null;
  company: string | null;
  industry: string | null;
  sourceRefs: Array<{ kind: string; id: string }>;
  relationship: 'new' | 'contacted';
  lastContactAt: string | null;
  researchSnapshotId: string | null;
  researchState: 'ready' | 'missing' | 'partial' | 'stale';
  availability: 'ready' | 'needs_research' | 'blocked';
  blockedReasons: CampaignRecipientBlockReason[];
};
```

Identity rule:

- Dedupe by organization plus lowercase trimmed email.
- Do not apply provider-specific Gmail dot or plus-address transformations.
- Preserve all source references for provenance and future detail views.
- Prefer current contacted-history data for delivery and suppression context;
  prefer enriched data for professional profile fields and research linkage.

### Enrollment state

Use two state machines instead of one overloaded status.

```ts
type CampaignEnrollmentState =
  | 'pending_initial_send'
  | 'waiting_research'
  | 'active'
  | 'paused'
  | 'stopped'
  | 'completed';

type CampaignRecipientStepState =
  | 'waiting_research'
  | 'not_due'
  | 'review_required'
  | 'drafting'
  | 'approved'
  | 'dispatch_pending'
  | 'sending'
  | 'sent'
  | 'deferred'
  | 'failed'
  | 'unknown'
  | 'skipped'
  | 'blocked';

type CampaignStopReason =
  | 'reply_received'
  | 'negative_reply'
  | 'unsubscribe'
  | 'do_not_contact'
  | 'invalid_email'
  | 'hard_bounce'
  | 'blocked_domain'
  | 'manual_stop'
  | 'campaign_conflict'
  | 'privacy_blocked'
  | 'campaign_archived';
```

Required transitions:

```text
Initial plan saved
  -> enrollment: pending_initial_send

Fixed audience selected without valid research
  -> enrollment: waiting_research
  -> first step: waiting_research

Research becomes valid for a waiting recipient
  -> enrollment: active
  -> first step: review_required or not_due according to campaign timing

Initial message sent and finalized
  -> initial step: sent
  -> enrollment: active
  -> next step: not_due

Due date reached
  -> next step: review_required

Native draft created
  -> next step: drafting

Native draft approved
  -> next step: approved

Provider dispatch requested
  -> next step: dispatch_pending or sending

Provider confirms send
  -> next step: sent
  -> future step: not_due, or enrollment: completed

Reply, unsubscribe, bounce, or manual stop
  -> enrollment: stopped
  -> every unsent step: blocked or skipped
```

Opening and clicking are timeline signals. They do not change the recipient
step state unless a separate, explicit product rule is approved later.

## Proposed Persistence Model

### Preserve existing tables

Keep using these tables as their current authoritative roles:

| Existing table | Continue using for |
| --- | --- |
| `campaigns` | Legacy compatibility and v2 campaign container. |
| `campaign_steps` | Legacy-only sequence storage while v2 migrates. |
| `campaign_deliveries` | Immutable dispatch-backed campaign delivery projection. |
| `outbound_dispatches` | Provider dispatch idempotency and outcome truth. |
| `contacted_leads` | Contact-history projection. |
| `research_snapshots` | Immutable report-backed research source. |
| native draft tables | Recipient-specific content, review, and approval. |

### Additive v2 tables

Create the following through forward-only Supabase migrations. Names can be
adjusted to repository naming conventions, but the responsibilities and
constraints must remain.

#### `campaign_sequence_versions`

One immutable sequence definition per campaign revision.

Required fields:

```text
id uuid primary key
organization_id uuid not null
user_id uuid not null
campaign_id uuid not null
version_number integer not null
lifecycle draft | published | superseded | archived
strategy_summary text not null
style_profile_id uuid nullable
created_from_instruction text nullable
generator_metadata jsonb not null default {}
created_at timestamptz not null
published_at timestamptz nullable
```

Constraints and indexes:

- Unique `(campaign_id, version_number)`.
- Index `(organization_id, campaign_id, lifecycle, version_number desc)`.
- Published versions cannot be edited in place.

#### `campaign_sequence_steps_v2`

Ordered generic steps belonging to one sequence version.

Required fields:

```text
id uuid primary key
organization_id uuid not null
sequence_version_id uuid not null
step_index integer not null
kind initial | follow_up | close_loop
name text not null
offset_days integer not null
base_instruction text nullable
base_subject text nullable
base_body text nullable
requires_human_review boolean not null default true
created_at timestamptz not null
```

Constraints and indexes:

- Unique `(sequence_version_id, step_index)`.
- `step_index >= 0` and `offset_days >= 0`.
- Initial-contact sequences have exactly one `initial` step at index `0`.
- Re-engagement sequences may use an initial step as the first new-reason
  message, but it still requires a recipient-specific native draft.

#### `campaign_enrollments`

One durable campaign-recipient membership and progress row.

Required fields:

```text
id uuid primary key
organization_id uuid not null
user_id uuid not null
campaign_id uuid not null
sequence_version_id uuid not null
recipient_key text not null
recipient_email text not null
recipient_snapshot jsonb not null
source_refs jsonb not null default []
research_snapshot_id uuid nullable
contacted_id text nullable
initial_dispatch_id uuid nullable
audience_origin manual | dynamic | legacy_backfill
enrollment_state pending_initial_send | waiting_research | active | paused | stopped | completed
stop_reason text nullable
next_due_at timestamptz nullable
last_activity_at timestamptz nullable
selected_at timestamptz not null
enrolled_at timestamptz nullable
completed_at timestamptz nullable
stopped_at timestamptz nullable
created_at timestamptz not null
updated_at timestamptz not null
```

Constraints and indexes:

- Unique `(organization_id, campaign_id, recipient_key)`.
- `recipient_email` must pass the same basic email validation used by campaign
  delivery data.
- Index `(organization_id, campaign_id, enrollment_state, next_due_at, id)`.
- Index `(organization_id, recipient_key, enrollment_state)` for conflict
  checks.
- `contacted_id` is nullable before the first confirmed email and populated by
  server-side finalization after send.

#### `campaign_recipient_steps`

One planned step per enrollment, with native-draft and dispatch linkage.

Required fields:

```text
id uuid primary key
organization_id uuid not null
campaign_id uuid not null
enrollment_id uuid not null
sequence_version_id uuid not null
sequence_step_id uuid not null
step_index integer not null
state text not null
due_at timestamptz nullable
native_draft_id uuid nullable
native_draft_version_id uuid nullable
dispatch_id uuid nullable
campaign_delivery_id uuid nullable
research_snapshot_id uuid nullable
reviewed_at timestamptz nullable
sent_at timestamptz nullable
failure_code text nullable
failure_message text nullable
created_at timestamptz not null
updated_at timestamptz not null
```

Constraints and indexes:

- Unique `(enrollment_id, sequence_version_id, step_index)`.
- Unique non-null `dispatch_id`.
- Index `(organization_id, state, due_at, id)` for the review inbox.
- Index `(organization_id, campaign_id, enrollment_id, step_index)` for the
  campaign detail query.

The first-contact native draft is linked to step `0` before provider send. The
dispatch finalizer populates `dispatch_id`, resolves `contacted_id`, and
creates or links the `campaign_deliveries` projection after an accepted send.

#### `campaign_audience_evaluations`

Use for auditable dynamic audience evaluation and fixed-audience preview
fingerprints.

Required fields:

```text
id uuid primary key
organization_id uuid not null
campaign_id uuid not null
mode fixed | dynamic
definition_hash text not null
evaluated_at timestamptz not null
candidate_count integer not null
eligible_count integer not null
newly_enrolled_count integer not null
blocked_count integer not null
result_summary jsonb not null default {}
```

This table is not the source of recipient membership. It allows the UI to say
when a dynamic audience last changed and prevents a user from approving an
outdated preview without a warning.

#### `campaign_enrollment_events`

Create this append-only table in phase 3 if the product needs a durable audit
timeline beyond what can be reconstructed from dispatches and recipient-step
rows. It should record enrollment, stop, review, approval, due, and version
transitions without duplicating raw email content.

### Campaign container changes

Add only additive nullable or defaulted fields to `campaigns`:

```text
engine_version legacy | v2
program_kind first_contact_follow_up | reengagement | legacy_follow_up | legacy_reconnection
lifecycle_state draft | in_review | active | paused | completed | archived
audience_definition jsonb
active_sequence_version_id uuid nullable
```

Do not change the meaning of existing `status`, `campaign_type`,
`excluded_lead_ids`, or `sent_records` until a separate migration and removal
plan has been approved.

## Audience Resolver

Implement one server-side resolver used by audience preview, snapshotting,
dynamic evaluation, conflict checks, and campaign activation.

Suggested module boundary:

```text
src/lib/server/campaigns-v2/audience-resolver.ts
```

Responsibilities:

1. Authorize the current organization scope.
2. Read visible lead sources in bounded, server-side queries.
3. Normalize every candidate to `AudienceCandidateV2`.
4. Dedupe by normalized email.
5. Merge source provenance without exposing inaccessible records.
6. Apply immutable safety suppressions.
7. Apply filters and audience mode rules.
8. Report `ready`, `needs_research`, and `blocked` separately.
9. Detect active campaign conflicts for the same recipient.
10. Return a stable fingerprint for review and snapshot confirmation.

Source order for field selection:

1. Contacted history supplies delivery, reply, unsubscribe, and conversation
   context.
2. Enriched leads supply professional fields and research linkage.
3. Saved leads supply base lead data.
4. People-search records supply candidate data only when they are visible in
   the current organization and have a usable email.

Audience filter examples:

- Lead source.
- Company, industry, title, or location.
- Email availability and verification status.
- Research readiness.
- New vs previously contacted relationship.
- Last contact interval.
- Prior engagement signal, displayed in human language.
- Current commercial stage.

Audience selection behavior:

- Search and filters change the visible candidate list but never silently clear
  an existing fixed selection.
- The master checkbox is explicitly scoped: `Seleccionar N visibles`.
- Show hidden selections: `24 seleccionados; 6 fuera de estos filtros`.
- Dynamic filters are stored as a typed validated definition, not arbitrary UI
  objects copied into JSON.
- Fixed selection is positive membership. Do not use `excluded_lead_ids` as the
  primary audience model.

## Research and Readiness Rules

Separate selection from send readiness.

| Candidate state | Can select | Can create personalized draft | Can enter review queue |
| --- | --- | --- | --- |
| Usable email and valid research | Yes | Yes | Yes |
| Usable email, no research | Yes | No | No; prompt for research |
| Partial or stale research | Yes | Only if current policy permits it | Show warning or require refresh |
| Privacy, DNC, hard bounce, invalid email | Visible but blocked | No | No |
| Active conflicting campaign | Yes, with warning | No by default | No without explicit override policy |

For an initial-contact follow-up plan, the research snapshot used by the first
native draft is pinned to the enrollment. For a future step, use the current
valid snapshot only if the campaign policy permits refresh. Do not silently
replace factual context in an already-approved draft.

## AI Contracts

### Sequence strategy proposal

Create a new strict schema for AI-generated sequence strategy. Do not reuse
the generic legacy `generateCampaignFlow` as the sendable v2 source.

```ts
type CampaignSequenceProposalV2 = {
  strategySummary: string;
  steps: Array<{
    name: string;
    kind: 'initial' | 'follow_up' | 'close_loop';
    offsetDays: number;
    intent: string;
    subjectGuidance: string;
    bodyGuidance: string;
  }>;
  assumptions: string[];
  warnings: string[];
};
```

Inputs must include:

- Campaign purpose, offer, CTA, and allowed tone.
- Sender profile and selected style profile.
- Recipient report only for a personal follow-up plan.
- Aggregated audience facts only for re-engagement strategy generation.
- Explicit constraints: no unsupported claims, no hidden send action, no
  duplicate CTA, and no generic factual assertions.

### Recipient draft generation

Generate actual recipient email drafts through the existing native-draft path:

```text
ResearchSnapshotV1 + DraftContextV2 + campaign strategy + recipient step
  -> native draft revision
  -> preflight
  -> human approval
  -> provider dispatch
```

The recipient step stores the resulting native draft ID and version ID. It
must not copy the final content into campaign tables as a second mutable source
of truth.

### Conversational rewrite

Extend the current native rewrite behavior or add a campaign v2 proposal route.
The endpoint must support an instruction, style profile, scope, and optimistic
version identity. It returns a proposal or a new child revision only after all
provenance and preflight checks pass.

Suggested request shape:

```ts
type CampaignAiInstructionRequest = {
  instruction: string;
  scope: 'current_draft' | 'current_step' | 'unsent_steps' | 'add_step' | 'strategy';
  campaignId: string;
  sequenceVersionId: string;
  enrollmentId?: string;
  recipientStepId?: string;
  expectedVersionId?: string;
  styleProfileId?: string | null;
};
```

Do not persist a full free-form chat transcript by default. Persist successful
instruction metadata, proposal lineage, model, prompt version, and accepted
version references as part of the audit trail. Treat raw prompts as potentially
sensitive business data and apply retention policy before storing them.

## API Surface

All v2 writes must be server-side. Do not add direct browser Supabase writes
for campaign creation, step replacement, enrollment, or state transitions.

### First-contact follow-up plan

```text
POST   /api/campaigns/v2/first-contact-plans
GET    /api/campaigns/v2/first-contact-plans/[campaignId]
PATCH  /api/campaigns/v2/[campaignId]/sequence-draft
POST   /api/campaigns/v2/[campaignId]/sequence-proposals
POST   /api/campaigns/v2/[campaignId]/publish-sequence-version
```

`POST /first-contact-plans` accepts an existing native initial draft identity,
recipient identity, research snapshot, sequence proposal or steps, and desired
timing. It creates a v2 draft campaign, sequence version, enrollment in
`pending_initial_send`, and recipient step zero linked to the native draft.

### Re-engagement builder

```text
POST   /api/campaigns/v2
PATCH  /api/campaigns/v2/[campaignId]
POST   /api/campaigns/v2/[campaignId]/audience/preview
PUT    /api/campaigns/v2/[campaignId]/audience
POST   /api/campaigns/v2/[campaignId]/audience/confirm
POST   /api/campaigns/v2/[campaignId]/activate-review-queue
```

`audience/preview` is non-mutating and returns a fingerprint. `audience/confirm`
requires the expected fingerprint; it must reject or warn on materially changed
results. Fixed audiences create enrollment rows. Dynamic audiences store the
definition and run an initial append-only evaluation.

### Recipient operations and CRM

```text
GET    /api/campaigns/v2/[campaignId]/recipients?state=&cursor=&limit=
GET    /api/campaigns/v2/[campaignId]/summary
GET    /api/campaigns/v2/[campaignId]/events?cursor=&limit=
POST   /api/campaigns/v2/[campaignId]/enrollments/[enrollmentId]/stop
POST   /api/campaigns/v2/[campaignId]/enrollments/[enrollmentId]/resume
POST   /api/campaigns/v2/recipient-steps/[stepId]/prepare-draft
```

The recipient endpoint must use keyset pagination and server-side filtering.
Do not download all contacted leads to the browser for campaign detail.

### Dispatch finalization

Extend the server-owned dispatch finalization path. On a confirmed dispatch:

1. Resolve the native draft and associated `campaign_recipient_steps` row.
2. Finalize the outbound dispatch and contact-history projection atomically.
3. Resolve or create the compatible contacted-history link where policy allows.
4. Store `contacted_id`, `dispatch_id`, `campaign_delivery_id`, and `sent_at`.
5. Mark the recipient step as `sent`.
6. Calculate the next due step from the actual sent timestamp.
7. Mark the enrollment `completed` if no future step remains.
8. Never repeat the transition when an idempotency replay returns the same
   dispatch record.

The compose UI may read the dispatch receipt to redirect the user after send,
but it must not perform the authoritative enrollment update itself.

### Scheduler behavior

The v2 scheduler has only two jobs:

```text
Evaluate dynamic audiences
  -> append newly eligible enrollment rows
  -> stop or flag newly blocked future recipients

Process due recipient steps
  -> validate current safety state
  -> set step to review_required
  -> wait for a user to request native draft preparation in the review UI
  -> never call a provider
```

Use a v2-only route or worker and only process campaigns with
`engine_version = 'v2'`. Do not modify the legacy cron until v2 has its own
tests, flags, and controlled rollout. A later product decision may permit
background draft preparation, but it must remain a separate review-only action
and requires a privacy, cost, and observability review.

## Re-engagement Audience Rules

### Fixed mode

- Default for every new campaign.
- The user selects exact recipients.
- Store a recipient snapshot, source refs, research state, and selection time.
- A later data change does not add or remove people from the campaign.
- A safety event may stop a recipient, but should not erase their selection
  audit trail.

### Dynamic mode

- Hidden under advanced options for new campaigns.
- Store a validated filter definition and every evaluation result.
- Append new eligible recipients only once per campaign and recipient key.
- New recipients appear as review work, never as sent messages.
- Re-evaluate safety before draft preparation and again before provider send.
- Show `Last evaluated`, `newly eligible`, `blocked`, and `audience changed`
  in the UI.
- Do not silently remove recipients who no longer match filters after they have
  been enrolled; stop them only for a concrete safety or policy reason.

### Conflict policy

Default rule: one active email sequence per organization plus normalized
recipient email. A conflicting active sequence should be shown as a clear
block with the campaign name and next action. A later explicit override policy
may permit exceptions, but it must create an audit event and never bypass
privacy, reply, bounce, or DNC protections.

## Legacy Compatibility and Migration

### Do not migrate blindly

Legacy rows may have `sent_records` without dispatch-backed provenance. Do not
invent v2 enrollment state from those records.

Backfill only when all required evidence exists:

- Known organization and user scope.
- Existing campaign ID.
- Dispatch-backed campaign delivery.
- Known recipient key and contacted-history link.
- Deterministic step index and sent timestamp.

Mark records without complete provenance as `legacy/inferred` in UI. Keep them
read-only until a separate reconciliation plan is approved.

### Migration order

1. Inspect remote schema and migration history before adding fields.
2. Add v2 tables, indexes, constraints, and organization-scoped RLS.
3. Add v2 campaign container fields with safe defaults.
4. Add server services and contract tests with flags disabled.
5. Backfill only auditable dispatch-backed delivery history.
6. Ship read-only v2 CRM views before v2 campaign creation.
7. Enable first-contact plans for an organization allowlist.
8. Enable fixed re-engagement campaigns after dispatch finalization passes
   controlled tests.
9. Enable dynamic audiences last.

## Suggested Code Organization

Add dedicated v2 modules rather than growing the existing 1,700-line legacy
campaign page.

```text
src/lib/campaigns-v2/
  contracts.ts
  audience-filters.ts
  recipient-state.ts
  sequence.ts

src/lib/server/campaigns-v2/
  campaign-service.ts
  audience-resolver.ts
  enrollment-service.ts
  recipient-step-service.ts
  dispatch-finalizer.ts
  dynamic-audience-worker.ts
  review-queue-worker.ts
  permissions.ts

src/components/campaigns-v2/
  CampaignReviewInbox.tsx
  CampaignDetailWorkspace.tsx
  CampaignRecipientList.tsx
  CampaignRecipientFlow.tsx
  CampaignRecipientDrawer.tsx
  CampaignAudienceWorkspace.tsx
  CampaignAudienceFilters.tsx
  CampaignSequenceEditor.tsx
  CampaignAiConversation.tsx
  CampaignReengagementWizard.tsx
  FirstContactFollowUpPlan.tsx

src/app/api/campaigns/v2/
  ...route handlers described in this document

src/app/(app)/campaigns/
  page.tsx                 // Legacy entry or v2 feature-gated list
  [campaignId]/page.tsx    // V2 campaign detail
  new/reengagement/page.tsx
```

Reuse existing primitives and patterns:

- `Button`, `Input`, `Textarea`, `Checkbox`, `Table`, `Sheet`, `Dialog`,
  `Tabs`, `Collapsible`, `Skeleton`, and `Alert`.
- `CampaignFlow` for sequence-template visualization.
- `CommercialTimeline` for recipient history.
- Native draft APIs and `generateOutreachFromDraftContextV2` for safe
  recipient-specific drafting.
- Existing selection utilities only if their semantics match persistent
  selection. The current `retainVisibleSelection()` removes hidden selection,
  which is not correct for fixed audience selection and must not be reused for
  that behavior unchanged.

## Execution Status

| Phase | State | Notes |
| --- | --- | --- |
| 0. Contract and remote inventory | Partial | Local code and migration inventory completed. Remote PostgreSQL/RLS/concurrency validation is still required. |
| 1. V2 persistence and server contracts | Implemented locally | Additive migration, service-only RPCs, RLS, durable manual dispatch, privacy guards, and static contract tests are complete; migration is un-applied. |
| 2. Lead and compose integration | Implemented locally | Initial-contact follow-up plan and explicit-send integration are implemented for the V2 slice. |
| 3. Campaign CRM | Implemented locally | Feature-gated review inbox, prepare-draft flow, stop action, and keyset pagination are implemented. |
| 4. Fixed re-engagement campaigns | Pending | Not included in the initial-contact V2 slice. |
| 5. Dynamic audiences | Pending | Not included in the initial-contact V2 slice. |
| 6. Migration and rollout | Blocked | `npm test`, typecheck, and production build pass. Before release, validate the migration and concurrent privacy/send paths on real PostgreSQL, then obtain explicit approval to apply it and enable the flag. |

## Phase 0: Contract and Remote Inventory

### Tasks

- [ ] Inspect Supabase table definitions, constraints, RLS, policies, indexes,
  and migrations before drafting new SQL.
- [ ] Verify whether production has all fields referenced by current campaign
  and delivery code, especially campaign attribution on contacted history.
- [ ] Inspect `outbound_dispatches`, native draft tables, and the current
  history finalizer to identify the safest hook for a recipient-step link.
- [ ] Document the actual scheduler owner and ensure legacy campaign cron stays
  dry-run during v2 work.
- [ ] Define source-of-truth ownership for recipient data, delivery state,
  commercial state, research state, and content versions.
- [ ] Define exact transition rules and errors for reply, bounce, suppression,
  quota deferral, unknown provider outcome, and manual stop.
- [ ] Decide the organization policy for conflicting active sequences.

### Exit criteria

- A migration proposal references the deployed schema rather than assumptions.
- One server-owned dispatch finalization integration point is identified.
- No v2 work changes legacy campaign send behavior.

## Phase 1: V2 Persistence and Server Contracts

### Tasks

- [ ] Add forward-only migrations for v2 campaign fields and tables.
- [ ] Add organization-scoped RLS policies. Authenticated users may read visible
  campaign data; sensitive writes and state transitions remain server-owned.
- [ ] Add indexes for campaign review inbox, recipient detail, audience conflict
  lookup, and dynamic evaluation.
- [ ] Define Zod schemas and TypeScript contracts for every v2 entity.
- [ ] Implement a tenant-safe normalized audience resolver.
- [ ] Implement fixed selection persistence and dynamic append-only evaluation.
- [ ] Implement sequence-version creation and immutable publishing.
- [ ] Implement enrollment and recipient-step transition services.
- [ ] Implement dispatch-finalizer integration tests without changing the UI.
- [ ] Add a feature flag such as `campaigns_v2_enabled` scoped by organization.

### Exit criteria

- A test can create an initial-plan enrollment and a fixed re-engagement
  enrollment without client-owned writes.
- A recipient cannot be duplicated within a campaign.
- A blocked recipient cannot be marked ready for review.
- A confirmed initial dispatch advances exactly one enrollment once.

## Phase 2: Lead and Compose Integration

### Tasks

- [ ] Surface lead readiness consistently in enriched leads and research.
- [ ] Replace the `/research` redirect with a workspace or an explicit
  feature-gated workspace view.
- [ ] Add `FirstContactFollowUpPlan` to native compose for eligible initial
  drafts.
- [ ] Create a v2 personal follow-up plan from an existing native draft and
  research snapshot.
- [ ] Expose provider dispatch receipt to the compose product flow for
  post-send navigation only; final state remains server-owned.
- [ ] Build sequence editor interactions: add, remove, reorder unsent steps,
  change timing, and revert to a prior draft sequence version.
- [ ] Build the conversational AI proposal interaction with diffs and scope.
- [ ] Ensure content changes create new versions and reset review state.
- [ ] Add empty, error, loading, stale-research, and no-email states.

### Exit criteria

- A user can create an initial email, attach a two-step follow-up plan, review
  the first email, send it, and see the next step waiting in v2 data.
- A user can ask AI to revise an unsent step without altering sent history.
- No follow-up is sent or marked sent without an approved native draft and a
  confirmed dispatch.

## Phase 3: Campaign CRM

### Tasks

- [ ] Build a feature-gated Campaigns review inbox sorted by human action.
- [ ] Build campaign detail with server-paginated recipients.
- [ ] Implement the compact recipient flow visualization.
- [ ] Reuse `CommercialTimeline` in a recipient drawer.
- [ ] Add filters for recipient state, review status, stop reason, campaign
  type, and legacy records.
- [ ] Add recipient stop and allowed resume controls with confirmation.
- [ ] Add accessible mobile card layout and desktop table layout.
- [ ] Add campaign summary calculations that reconcile with recipient steps and
  dispatch-backed deliveries.

### Exit criteria

- A user can identify why every recipient is waiting, ready, sent, stopped, or
  completed without opening raw logs.
- The UI never claims a message was sent when its dispatch status is unknown.
- Campaign detail remains responsive with thousands of recipient rows through
  keyset pagination and bounded server queries.

## Phase 4: Fixed Re-Engagement Campaigns

### Tasks

- [ ] Add the standalone `Nueva razon para contactar` builder.
- [ ] Implement direct audience selection from all eligible-email sources.
- [ ] Implement fixed audience snapshots, search, filters, hidden-selection
  messaging, and blocked-reason visibility.
- [ ] Implement campaign strategy generation and sequence editing.
- [ ] Create recipient steps only after audience confirmation and sequence
  publication.
- [ ] Use the review queue to prepare individual native drafts; do not bulk
  approve or bulk send.
- [ ] Add campaign conflict warnings and policy enforcement.
- [ ] Link each generated message to its recipient research snapshot and
  sequence version.

### Exit criteria

- A user can create a fixed new-reason campaign, select exact recipients, see
  who requires research, and activate a review queue without automatic sends.
- Newly added leads do not enter the fixed campaign without user action.
- Audience preview, activation, review queue, and recipient detail resolve the
  same recipient membership.

## Phase 5: Dynamic Audiences

### Tasks

- [ ] Add advanced dynamic audience mode with typed filters.
- [ ] Add evaluation worker with bounded, idempotent append-only enrollment.
- [ ] Add evaluation fingerprint, member diff, and last-evaluated UI.
- [ ] Recheck safety immediately before native draft creation and provider send.
- [ ] Add counters for newly eligible, blocked, already enrolled, and
  needs-research recipients.
- [ ] Add audit events for dynamic membership changes.
- [ ] Add guardrails for high-volume changes and require a fresh review when a
  configurable threshold is exceeded.
- [ ] Keep recipients without valid research out of the review queue while
  reporting them as `requieren investigacion` in evaluation results.

### Exit criteria

- New matching leads enter review work once and never receive provider delivery
  without individual approval.
- A user can understand exactly when and why audience membership changed.

## Phase 6: Migration, Verification, and Rollout

### Tasks

- [ ] Backfill only dispatch-backed legacy deliveries into v2 read models.
- [ ] Label incomplete legacy history as inferred or legacy in the UI.
- [ ] Ship with v2 flags disabled by default.
- [ ] Enable for an internal organization with send actions still manually
  reviewed.
- [ ] Run a no-send canary: create plans, audience previews, recipient steps,
  review drafts, and stop transitions without provider delivery.
- [ ] Run a controlled single-recipient end-to-end send only after explicit
  release approval.
- [ ] Reconcile native draft, outbound dispatch, contacted-history,
  campaign-delivery, enrollment, and recipient-step counts.
- [ ] Run rollback rehearsal by disabling flags and pausing v2 workers while
  preserving additive data.
- [ ] Decide whether and when legacy creation UI can be deprecated.

### Exit criteria

- V2 feature flags can be disabled without corrupting v2 or legacy history.
- Reconciliation finds no orphaned sent recipient step and no duplicate
  provider dispatch for the same recipient step.
- Product, security, and visual verification are signed off.

## Test Plan

### Unit tests

- Audience normalization and dedupe across every source type.
- Immutable suppression and blocked-reason logic.
- Fixed selection persistence when filters change.
- Dynamic append-only evaluation and duplicate prevention.
- Sequence version publishing and no mutation of past versions.
- Recipient-step state transitions.
- Reply, unsubscribe, bounce, domain block, and manual stop transitions.
- Campaign conflict detection.
- AI proposal validation, unsupported-claim rejection, and approval reset.
- Due date calculation from actual prior sent time.

### Integration tests

- RLS and organization isolation for every new table and endpoint.
- Initial native draft linked to a first-contact plan.
- Approved initial send finalizes contact history and activates exactly one
  enrollment.
- Dispatch replay does not duplicate history, delivery, enrollment progress, or
  recipient step advancement.
- A due step becomes review-required but does not invoke a provider.
- Approved follow-up dispatch creates one durable delivery and advances once.
- Reply ingestion stops pending future steps before they can be drafted.
- Fixed audience preview and confirmed membership match exactly.
- Dynamic evaluation appends new members without re-enrolling old members.
- Legacy campaign records remain readable and unchanged.

### UI and accessibility tests

- Compose follow-up plan at 360, 390, 768, 1024, and 1440px.
- Campaign recipient list at the same widths in light and dark modes.
- Keyboard sequence editing, audience selection, dialogs, sheets, and drawers.
- Focus return and visible focus ring after closing overlays.
- AI loading, proposal, error, conflict, and retry states.
- Empty audience, zero ready recipients, blocked recipient, stale research, and
  provider connection states.
- `aria-live` behavior for stable audience and review counts.
- No page horizontal scroll on mobile.

### Required verification commands

Run the repository-standard commands applicable to modified packages, at least:

```text
npm test
npm run typecheck
npm run lint
npm run build
```

Run focused tests after each phase before the full suite. For schema changes,
also inspect Supabase security and performance advisors after migrations are
applied to the target environment.

## Observability

Track tenant-safe operational counters and avoid storing raw email content in
analytics events.

- Audience preview duration and result count.
- Fixed selection count, dynamic evaluation count, and member diffs.
- Recipients by review-required, sent, stopped, deferred, failed, and unknown.
- Native draft creation, preflight block, approval, and rewrite rates.
- Dispatch finalization success and idempotency replay rates.
- Reply-to-stop latency.
- Campaign conflict blocks.
- Queue age for `review_required` recipient steps.
- AI proposal acceptance and rejection rates.

Use structured logs with campaign, enrollment, recipient-step, draft, and
dispatch identifiers. Do not log raw instructions, report excerpts, provider
tokens, or email body content outside approved audit storage.

## Decisions To Confirm Before Phase 1

The implementation should use these defaults unless product explicitly changes
them:

1. Every recipient message requires individual human review and approval before
   provider send.
2. Follow-up enrollment begins only after the initial email is confirmed sent.
3. Research is required for AI-personalized content, but not for selecting a
   lead into a campaign audience.
4. One active outbound sequence per recipient email is the default conflict
   policy.
5. Dynamic audiences append recipients to a review queue and never send them
   automatically.
6. First-contact follow-up plans are personal to one recipient; they are not
   reusable audience templates without explicit conversion to re-engagement.

## Definition Of Done

- The user can progress from researched lead to reviewed initial email to a
  visible personal follow-up plan without using the legacy campaign creator.
- Users can change unsent emails and sequence structure conversationally with
  AI while retaining provenance, versions, and approval controls.
- Campaigns provides a truthful CRM-style recipient flow with a clear next
  human action for every lead.
- Re-engagement supports direct selection of all usable-email leads, fixed
  audiences by default, and dynamic audiences only as an advanced review-first
  mode.
- No automatic send path is added.
- Every confirmed provider dispatch remains idempotent, traceable, and linked
  to the exact approved native draft, recipient step, campaign version, and
  research snapshot where applicable.
- Legacy campaigns continue to render and retain their existing behavior until
  a separate approved retirement milestone.
