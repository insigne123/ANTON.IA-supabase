# Research and Messaging Architecture (Historical Audit)

## Status

This document records the repository audit and the proposed boundary between lead research and outbound messaging.

> Historical record only. Phase 7 retires the n8n and legacy SerpAPI runtime paths; `/api/research/n8n` now returns `410 Gone`. This is not deployment or integration guidance.

The n8n workflow `5W8jii9ERNhAUoVX` was inspected in read-only mode on 2026-08-12. No workflow node, credential, execution, or setting was modified. Credential values and pinned request data were not copied into this document.

The inspection covered the saved editor definition, the active definition captured by the latest successful execution, and output shape metadata. Historical-version listing was not available to the authenticated role. The active and saved definitions are not identical, so this document distinguishes deployed behavior from an unpublished draft.

## Historical n8n Workflow Audit

### Identity and versions

- Workflow ID: `5W8jii9ERNhAUoVX`.
- Current name: `My workflow 7`.
- Created: 2026-05-08.
- Last saved: 2026-06-24.
- State at inspection time: active.
- Saved editor version: `ee643450-21fb-41c3-87d2-697c9580e5f5`.
- Published version at inspection time: `1d196061-f430-421d-aff7-63d3ad38158a`.
- Version counter: 7.
- The webhook path active at inspection time was `ANTONIA`, matching the then-current app configuration and Firebase fallback.
- The saved but unpublished editor draft changes the path to `ANTONIA2.0`.

The editor's `Publish` state and the distinct version IDs confirm that `ANTONIA2.0` was not the deployed endpoint at inspection time. Phase 7 retires both legacy paths instead of publishing either one.

### Graph

The workflow has six enabled nodes and no disabled nodes:

```text
POST Webhook
  -> If use_social_context is true
     -> SerpAPI HTTP Request
     -> JavaScript snippet formatter
     -> OpenAI search-preview model with social context
  -> otherwise
     -> OpenAI search-preview model without social context
```

The webhook returns the last node's first JSON item. There is no explicit response-normalization node.

### Inputs and branching

The prompts read these nested fields:

```text
body.companies[0].targetCompany
body.companies[0].lead
body.userContext
body.userCompanyProfile
body.use_social_context
```

The `If` node uses strict boolean validation. Only boolean `true` selects the social branch; a string value such as `"true"` does not.

The application proxy accepts several root and nested input shapes, but the workflow prompts require `companies[0]`. Root-level canonical fields forwarded by `/api/research/n8n` do not make a root-only request compatible with the workflow.

The observed pinned input has one company and includes lead, seller, company-profile, and social-context fields. The workflow currently retains this pinned request data in both the saved and active definitions. Production-like personal or commercial data should not remain pinned.

### Non-social branch

- Model: `gpt-4o-mini-search-preview-2025-03-11`.
- The prompt combines company research, seller fit, sales strategy, subject generation, and a 120-160 word email in one call.
- The system instruction says to use only user-provided evidence, while the input supplies target identity and seller context rather than a structured evidence set.
- The node does not enable n8n's JSON-output option and has no runtime schema validator.

### Social branch

- SerpAPI query: Google results restricted to LinkedIn using the lead name and target company.
- The request asks for three results, although the observed provider response contained more and the code truncates to three.
- The JavaScript node keeps only each result's title and snippet.
- Result URLs, publication dates, source identity, and other provenance are discarded before model generation.
- Model: `gpt-4o-mini-search-preview`.
- The prompt asks the model to decide whether activity is recent, including a less-than-30-day rule, but the formatter supplies no date.
- The prompt requires externally derived claims to have traceable URLs, but the LinkedIn snippets passed as lead evidence contain no URLs.
- The model is also allowed to perform web search, so its citations and SerpAPI evidence are merged implicitly rather than represented as separate sources.
- The same call generates company research, person context, sales strategy, subject lines, and the email body.

### Output contract

Both branches request a JSON object containing:

- Company fields.
- Overview, pains, opportunities, risks, value propositions, and use cases.
- Talk tracks, subject lines, an email draft, and next steps.
- Sources, contradictions, and section-level confidence.
- The social branch additionally returns lead context and an icebreaker.

The actual n8n response is the native OpenAI node envelope:

```text
{
  index,
  message: { role, content, refusal, annotations },
  finish_reason
}
```

The requested report is JSON encoded inside `message.content`. Consequently, `unwrapLeadResearchResponse()` and its assistant-envelope compatibility behavior are required until a normalized response node is introduced.

The prompt's contradiction shape is an array of objects, while the legacy `CrossReport` type expects `string[]`. This is another provider/consumer contract mismatch that should be resolved in the V1 adapter rather than preserved in the canonical schema.

### Observed execution

The latest successful execution inspected was webhook execution `499` on 2026-08-12:

- Total duration: approximately 6 seconds.
- Branch: social.
- SerpAPI request: approximately 255 ms.
- Model call: approximately 5.7 seconds.
- Result: valid JSON inside `message.content`, with one model annotation.
- The report contained no pains, opportunities, risks, value propositions, use cases, talk tracks, or subject alternatives.
- The generated email had 78 words despite the required 120-160 range.

This confirms that prompt instructions alone do not enforce report completeness or email constraints. The workflow returned success without semantic validation.

### Failure and lifecycle behavior

- No node retries are configured.
- No per-node timeout is configured in the workflow.
- No `continueOnFail` behavior is configured.
- No error branch or error workflow is configured.
- No idempotency key or deduplication is implemented.
- No callback, polling job, persisted report, or explicit lifecycle status is produced.
- A SerpAPI failure stops the entire social branch instead of falling back to the non-social model.
- The application timeout wrapper does not abort the underlying webhook request, so a timed-out call can continue in n8n without a reconciliation path.

### Security findings

- At inspection time, the webhook node used no n8n authentication. The application could send a bearer header, but the workflow trigger itself did not require it.
- The SerpAPI key is configured directly in the HTTP query parameters rather than through an n8n credential reference.
- The workflow stores pinned webhook input containing lead and seller context.
- The raw SerpAPI response and model output remain available in execution data according to n8n's execution-retention configuration.

Historical remediation (superseded by runtime retirement):

1. Protect the webhook with header authentication or an authenticated internal gateway and reject unauthenticated direct requests.
2. Retire SerpAPI access and rotate the historical key after migration.
3. Remove pinned production-like request data and replace it with a synthetic fixture.
4. Set an explicit execution-data retention policy appropriate for personal and commercial data.
5. Do not publish either n8n path; retire callers through the native research migration.

## Decision

Separate the system into three durable boundaries:

1. `ResearchSnapshotV1` stores immutable sources, evidence, claims, confidence, freshness, and research lifecycle state.
2. `MessagingDraftV1` stores versioned email, LinkedIn, or phone content and references the research claims used to produce it.
3. `OutboundDispatchV1` stores an idempotent delivery attempt and references the exact approved draft revision that was sent.

Research must not contain email copy, subject alternatives, talk tracks, call scripts, seller value propositions, CTA recommendations, approval state, or delivery state.

Messaging must not copy provider-native research payloads. It references one research snapshot and the specific claims used in the content.

Delivery is not a draft state. A sent message is an outbound dispatch linked to an immutable draft revision and content hash.

## Why This Is Needed

The current `CrossReport` mixes evidence, hypotheses, sales strategy, and a complete email draft in one type (`src/lib/types.ts`). The research adapter selects a preferred email while normalizing research and duplicates it into `EnhancedReport` (`src/lib/lead-research.ts`). The request also sends seller context and explicitly asks the research provider for an outreach pack.

That coupling creates several operational problems:

- Evidence cannot be reused safely without also reusing person-specific copy.
- Research readiness can be incorrectly inferred from the presence of an email body.
- Rewrites replace content without retaining parent draft lineage.
- The exact body and generator metadata are usually lost after sending.
- Browser, opportunity, Firebase, Next.js, and SUPL.IA paths persist different projections.
- It is difficult to prove which claims supported an automated message.
- It is difficult to reconcile or safely retry an unknown provider outcome.

## Current Pipeline Inventory

### Manual lead research

```text
/saved/leads/enriched
  -> POST /api/lead-research
  -> remote research service
  -> client polling through GET /api/lead-research/{reportId}
  -> adaptLeadResearchResponseToReport()
  -> browser localStorage
  -> report, email, LinkedIn, and phone consumers
```

Important behavior:

- Initial terminal responses are stored in `lead_research_reports`.
- Results that become terminal during polling are not stored server-side.
- Browser storage is not scoped by user or organization.
- Browser lookup can reuse a report by company domain or name.

### Opportunity research

```text
/saved/opportunities/enriched
  -> POST /api/research/n8n
  -> synchronous n8n webhook
  -> loose response normalization
  -> enriched_opportunities.data.report
  -> report and contact consumers
```

Important behavior:

- Almost any successful JSON response can become a report.
- Contact eligibility only requires a truthy report and email.
- Bulk contact calls `/api/email/bulk-send`, but that route does not exist.

### ANTONIA workers

```text
mission task
  -> canonical research service with polling
  -> direct n8n fallback
  -> worker-specific normalization/readiness checks
  -> research embedded in CONTACT task payload
  -> generated or fallback message
  -> provider send
```

Important behavior:

- Research normalization is duplicated in Firebase Functions.
- Full research is not consistently persisted to the server report table.
- One readiness implementation treats `emailDraft.body` as meaningful research.
- The Firebase campaign generator calls an authenticated app route without session or internal authentication and normally falls back silently.

### Next.js backup and server consumers

```text
CONTACT/reconnection/reply flow
  -> findCachedLeadResearchReport()
  -> ensureLeadResearchReport() on miss
  -> lead_research_reports
  -> mission fit, reconnection, reply drafting, or timeline
```

Important behavior:

- `ensureLeadResearchReport()` does not poll queued jobs.
- It can adapt and persist a queued response as if it were a report.
- Cache lookup has no freshness validation.
- Company-domain fallback can return another person's report.

### Messaging

```text
research draft, campaign generator, deterministic template, or user input
  -> optional restyle/bulk rewrite
  -> placeholder and signature rendering
  -> fragmented validation
  -> provider adapter
  -> contacted_leads and email_events
```

Important behavior:

- Most flows pass loose `{ subject, body }` objects.
- Browser overrides store only subject, body, and timestamp.
- Campaign steps do not retain generator, prompt, model, or source report lineage.
- Most delivery records retain the subject but not the exact final body or draft revision.
- Provider routes differ in validation, approval, receipts, and observability.
- SUPL.IA artifact versions are the closest existing append-only precedent.

## Target Data Flow

```text
Research request
  -> ResearchJob
  -> provider sources
  -> strict legacy/provider adapter
  -> source and evidence validation
  -> claim derivation
  -> immutable ResearchSnapshotV1

ResearchSnapshotV1 + seller profile + purpose + style/template
  -> MessagingJob
  -> model, template, human input, or fallback
  -> claim-usage validation
  -> immutable MessagingDraftV1 revision
  -> preflight
  -> approval when required

Approved MessagingDraftV1 revision
  -> idempotent OutboundDispatchV1
  -> transport-only transformations
  -> provider
  -> provider receipt or unknown outcome reconciliation
```

## Shared Primitives

```ts
type IsoDateTime = string;
type Sha256 = `sha256:${string}`;
type ConfidenceV1 = number; // Runtime invariant: finite, 0 <= value <= 1.

type OwnershipScopeV1 =
  | {
      kind: 'organization';
      organizationId: string;
      ownerUserId: string;
    }
  | {
      kind: 'user';
      organizationId: null;
      ownerUserId: string;
    };

type ContractErrorV1 = {
  code:
    | 'provider_timeout'
    | 'provider_http_error'
    | 'invalid_response'
    | 'truncated_response'
    | 'validation_failed'
    | 'identity_mismatch'
    | 'insufficient_evidence'
    | 'persistence_failed'
    | 'generation_failed'
    | 'cancelled'
    | 'unknown';
  stage: 'request' | 'fetch' | 'parse' | 'normalize' | 'validate' | 'persist' | 'generate' | 'preflight';
  severity: 'warning' | 'blocking';
  retryable: boolean;
  message: string;
  provider?: string;
  sourceId?: string;
  observedAt: IsoDateTime;
};
```

`message` must be safe for users and logs. It must not contain credentials, request headers, raw provider bodies, private source excerpts, or stack traces.

## ResearchSnapshotV1

```ts
type ResearchSourceV1 = {
  id: string;
  type: 'official_site' | 'linkedin' | 'news' | 'jobs' | 'technology' | 'search_result' | 'registry' | 'other';
  url: string;
  canonicalUrl: string;
  title?: string;
  publisher?: string;
  provider: string;
  publishedAt?: IsoDateTime;
  retrievedAt: IsoDateTime;
  contentHash?: Sha256;
  reliability: ConfidenceV1;
};

type ResearchEvidenceV1 = {
  id: string;
  subjectScope: 'company' | 'person';
  kind: 'fact' | 'quote' | 'event' | 'profile_field' | 'observation';
  path: string;
  statement: string;
  sourceId: string;
  locator?: { kind: 'json_path' | 'provider_annotation' | 'page_section' | 'search_snippet'; value: string };
  excerpt?: string;
  observedAt?: IsoDateTime;
  extractedAt: IsoDateTime;
  confidence: ConfidenceV1;
  extraction: {
    method: 'rule' | 'provider' | 'model';
    provider: string;
    model?: string;
    version: string;
  };
};

type ResearchClaimV1 = {
  id: string;
  kind:
    | 'company_overview'
    | 'company_identity'
    | 'company_industry'
    | 'company_service'
    | 'company_size'
    | 'company_priority'
    | 'pain_hypothesis'
    | 'opportunity_hypothesis'
    | 'risk_hypothesis'
    | 'use_case_hypothesis'
    | 'lead_profile'
    | 'lead_role'
    | 'lead_recent_activity'
    | 'lead_communication_style'
    | 'news_signal'
    | 'hiring_signal'
    | 'technology_signal'
    | 'site_signal';
  subjectScope: 'company' | 'person';
  classification: 'fact' | 'hypothesis';
  statement: string;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  confidence: ConfidenceV1;
  freshness: {
    asOf: IsoDateTime;
    validUntil: IsoDateTime;
    policyVersion: 'research-freshness/v1';
  };
  derivation: {
    method: 'direct' | 'rule' | 'model';
    model?: string;
    promptVersion?: string;
  };
};

type ResearchStatusV1 =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'insufficient_data'
  | 'failed'
  | 'cancelled';

export type ResearchSnapshotV1 = {
  kind: 'research_snapshot';
  schemaVersion: 'research-snapshot/v1';
  id: string;
  revision: 1;
  scope: OwnershipScopeV1;
  subject: {
    leadRef: string;
    leadId?: string;
    email?: string;
    person: {
      fullName?: string;
      title?: string;
      linkedinUrl?: string;
      city?: string;
      country?: string;
    };
    company: {
      name?: string;
      domain?: string;
      websiteUrl?: string;
      linkedinUrl?: string;
      country?: string;
    };
  };
  request: {
    requestId: string;
    idempotencyKey: string;
    inputFingerprint: Sha256;
    provider: string;
    providerJobId?: string;
    language: string;
    depth: 'basic' | 'standard' | 'deep';
    requestedAt: IsoDateTime;
  };
  lifecycle: {
    status: ResearchStatusV1;
    queuedAt?: IsoDateTime;
    startedAt?: IsoDateTime;
    completedAt?: IsoDateTime;
    errors: ContractErrorV1[];
  };
  sources: ResearchSourceV1[];
  evidence: ResearchEvidenceV1[];
  claims: ResearchClaimV1[];
  contradictions: Array<{
    id: string;
    claimIds: string[];
    evidenceIds: string[];
    summary: string;
    status: 'unresolved' | 'resolved';
    resolution?: string;
  }>;
  quality: {
    assessmentVersion: 'research-quality/v1';
    coverage: {
      company: ConfidenceV1;
      person: ConfidenceV1;
      recentSignals: ConfidenceV1;
    };
    overallConfidence: ConfidenceV1;
  };
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};
```

### Research invariants

- Snapshot IDs are server-generated UUIDs or ULIDs. Refreshing research creates a new immutable snapshot.
- Source, evidence, and claim IDs are unique within the snapshot.
- Every evidence `sourceId` resolves within the same snapshot.
- Every claim evidence reference resolves within the same snapshot.
- Confidence and coverage values are finite and in the inclusive range `[0, 1]`.
- `completed` requires meaningful evidence-backed claims and no blocking errors.
- `partial` requires at least one usable claim plus a coverage, source, or parsing warning.
- A recovered truncated provider response becomes `partial` with `truncated_response`.
- `insufficient_data` means the operation completed technically but did not produce enough evidence for drafting.
- `failed` means no operationally usable snapshot exists.
- Person claims can be reused only through exact lead identity or normalized email.
- Company-domain matching may reuse company evidence, but it must never copy another person's claims or drafts.
- Provider raw envelopes are excluded. If temporarily needed for diagnostics, store a redacted copy separately with short retention.

### Research freshness

| Claim class | Default validity |
| --- | ---: |
| Legal identity and official domain | 90 days |
| Overview, services, industry, size, and technology | 30 days |
| Lead title and profile | 14 days |
| News, hiring, and recent activity | 7 days |
| Search snippet with unknown publication date | 24 hours, manual use only |

Freshness is evaluated when generating and again when sending. A snapshot may retain valid company identity claims while its recent-activity claims are stale.

## MessagingDraftV1

```ts
type MessagingContentV1 =
  | {
      channel: 'email';
      subject: string;
      textBody: string;
      htmlBody: string | null;
      replyTo?: string;
    }
  | {
      channel: 'linkedin';
      text: string;
    }
  | {
      channel: 'phone';
      opening: string;
      pitch: string;
      objections: Array<{ objection: string; response: string }>;
      closing: string;
    };

type DraftIssueV1 = {
  code:
    | 'missing_recipient'
    | 'missing_subject'
    | 'missing_body'
    | 'unresolved_placeholder'
    | 'unsupported_claim'
    | 'low_confidence_claim'
    | 'stale_claim'
    | 'unresolved_contradiction'
    | 'invalid_html'
    | 'suppressed_recipient'
    | 'blocked_domain'
    | 'missing_unsubscribe'
    | 'content_changed_after_approval';
  severity: 'warning' | 'blocking';
  message: string;
  location?: 'recipient' | 'subject' | 'body' | 'research';
  claimId?: string;
};

export type MessagingDraftV1 = {
  kind: 'messaging_draft';
  schemaVersion: 'messaging-draft/v1';
  id: string;
  revision: number;
  parentRevision: number | null;
  scope: OwnershipScopeV1;
  purpose: 'initial_outreach' | 'reconnection' | 'follow_up' | 'reply';
  recipient: {
    leadRef: string;
    leadId?: string;
    displayName?: string;
    company?: string;
    email?: string;
    linkedinUrl?: string;
    phone?: string;
  };
  generation: {
    method: 'model' | 'template' | 'human' | 'legacy_adapter' | 'fallback';
    idempotencyKey: string;
    inputFingerprint: Sha256;
    researchSnapshotId: string | null;
    claimUsages: Array<{
      claimId: string;
      locations: Array<'subject' | 'body' | 'opening' | 'pitch' | 'closing'>;
      mode: 'quoted' | 'paraphrased' | 'context';
    }>;
    sellerProfileRef?: { id: string; version?: string; contentHash: Sha256 };
    templateRef?: { id: string; version: string; contentHash: Sha256 };
    styleRef?: { id: string; version: string; contentHash: Sha256 };
    provider?: string;
    model?: string;
    modelTier?: string;
    promptVersion?: string;
    runId?: string;
    generatedAt: IsoDateTime;
  };
  transformations: Array<{
    type: 'render' | 'restyle' | 'bulk_edit' | 'signature' | 'manual_edit';
    actor: 'user' | 'system' | 'model';
    at: IsoDateTime;
    instruction?: string;
    runId?: string;
  }>;
  strategy: {
    recommendedAngle?: string;
    valuePropositions: string[];
    talkTracks: string[];
    alternateSubjects: string[];
    recommendedCta?: string;
  };
  content: MessagingContentV1 | null;
  contentHash: Sha256 | null;
  transportPolicy: {
    signature: 'profile' | 'none';
    unsubscribe: 'required' | 'not_applicable';
    tracking: { open: boolean; links: boolean };
  };
  lifecycle: {
    status: 'generating' | 'draft' | 'blocked' | 'approved' | 'rejected' | 'superseded' | 'failed';
    errors: ContractErrorV1[];
    supersededByRevision?: number;
  };
  preflight: {
    status: 'not_run' | 'passed' | 'warning' | 'blocked';
    validatorVersion: string;
    evaluatedAt?: IsoDateTime;
    evaluatedContentHash?: Sha256;
    issues: DraftIssueV1[];
  };
  review: {
    status: 'not_required' | 'pending' | 'approved' | 'rejected';
    reviewedBy?: string;
    reviewedAt?: IsoDateTime;
    approvedContentHash?: Sha256;
    note?: string;
  };
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};
```

### Messaging invariants

- Revisions are append-only. Editing revision `n` creates revision `n + 1`.
- Approved revisions are immutable.
- Any content edit invalidates the prior approval and preflight result.
- `generating` and `failed` require null content.
- Email requires a valid recipient email, subject, and text body.
- LinkedIn requires a profile URL and text. Phone requires a phone number and complete script sections.
- Approved content cannot contain unresolved placeholders.
- Every claim usage must resolve inside the referenced research snapshot.
- Direct factual personalization must use evidence-backed claims.
- Hypotheses must remain hypotheses and use non-absolute language.
- Compliance footers, tracking pixels, rewritten links, and provider MIME formatting are transport transformations, not draft content.
- `prepareOutboundEmail()` remains useful as a transport preparation layer but must run against a known draft revision and content hash.

### Automation policy

- Manual drafting may use partial research but must show warnings.
- Auto-drafting requires each factual claim used in copy to have confidence of at least `0.70`.
- Auto-send requires completed research, no stale used claims, no unresolved contradictions, factual claim confidence of at least `0.80`, passed preflight, and approved or policy-exempt content.
- `insufficient_data`, `failed`, and `partial` research cannot unlock automatic contact.

## OutboundDispatchV1

```ts
export type OutboundDispatchV1 = {
  kind: 'outbound_dispatch';
  schemaVersion: 'outbound-dispatch/v1';
  id: string;
  scope: OwnershipScopeV1;
  idempotencyKey: string;
  draftId: string;
  draftRevision: number;
  contentHash: Sha256;
  researchSnapshotId: string | null;
  provider: 'gmail' | 'outlook' | 'linkedin';
  status: 'pending' | 'sending' | 'sent' | 'unknown' | 'failed';
  providerMessageId?: string;
  providerThreadId?: string;
  contactedLeadId?: string;
  error?: ContractErrorV1;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  sentAt?: IsoDateTime;
};
```

Persist `pending` before calling the provider. A timeout after transmission becomes `unknown` and must be reconciled against provider metadata before retrying. It must not immediately resend.

## Idempotency

### Research

The research fingerprint is a canonical hash of ownership scope, normalized target identity, research options, provider, and extractor version. It excludes timestamps and seller messaging context.

Concurrent requests with the same scope and idempotency key return the same operation. A normal request may reuse a non-stale snapshot with the same fingerprint. Explicit refresh uses a new operation key and creates a new immutable snapshot.

### Messaging

The generation fingerprint includes snapshot ID, recipient identity, purpose, channel, seller profile hash, template/style versions, prompt version, and generation options. Retries with the same idempotency key return the same draft revision.

Human edits use compare-and-swap with `expectedRevision`. Conflicts return `409 draft_revision_conflict`.

### Delivery

The dispatch key includes draft ID, revision, content hash, provider, and campaign step when applicable. A unique scope and idempotency-key constraint prevents duplicate sends during retries.

## Persistence Model

| Table | Role |
| --- | --- |
| `research_snapshots` | Immutable snapshot JSON with indexed scope, subject, status, fingerprint, and freshness dates |
| `messaging_drafts` | Draft head, recipient, purpose, generation key, and latest revision |
| `messaging_draft_versions` | Immutable `MessagingDraftV1` revisions with unique `(draft_id, revision)` |
| `outbound_dispatches` | Idempotent provider attempts and reconciliation state |

The append-only pattern in `suplia_artifact_versions` is the local precedent for version history. Generic SUPL.IA artifacts should not become the canonical message table because drafts require recipient privacy, preflight, approval, and send lineage.

During migration, `contacted_leads.data` and `email_events.meta` can retain `draftId`, `draftRevision`, `contentHash`, `researchSnapshotId`, and `dispatchId` before dedicated foreign-key columns are introduced.

## Compatibility Adapters

### Provider response adapter

Introduce one strict adapter:

```ts
adaptLegacyResearchPayloadV1(payload, context): {
  snapshot: ResearchSnapshotV1;
  drafts: MessagingDraftV1[];
  legacyExtras: LegacyResearchExtras;
}
```

It must support the existing nested report, direct cross payload, assistant message/content, annotations, fenced JSON, truncated JSON, and n8n fallback fixtures.

### Legacy projection

Existing consumers temporarily receive:

```ts
projectLegacyLeadResearchReport(snapshot, drafts, legacyExtras): LeadResearchReport
```

`CrossReport.emailDraft`, `EnhancedReport`, and provider-specific `raw` access are compatibility projections, not canonical storage.

### Persisted compatibility obligations

| Legacy source | Temporary behavior |
| --- | --- |
| `leadflow-lead-research` | Read-once conversion into scoped snapshot storage; stop new legacy writes after cutover |
| `leadflow-email-drafts` | Convert each override into a human-authored draft revision |
| `lead_research_reports.report` | Backfill snapshot and draft records while retaining the old row ID as migration metadata |
| `enriched_opportunities.data.report` | Replace with snapshot/draft references and temporarily project `report` for old UI code |
| `suplia_reply_drafts` | Adapt to reply-purpose drafts until reply sending uses canonical draft IDs |
| Compose URL/session subject and body | Create a human or legacy-adapter draft immediately instead of transporting anonymous content |

Do not preserve indefinitely:

- `raw: any` as canonical data.
- `EnhancedReport` as stored data.
- Company-name fallback for person research.
- `CrossReport.emailDraft` after consumers migrate.
- Anonymous automated send payloads.
- Permanent dual writes after backfill and read telemetry reach zero.

## Migration Plan

Deployment is migration-first and requires every migration below in exact lexical order:

1. `supabase/migrations/20260813093000_research_messaging_v1.sql`
2. `supabase/migrations/20260813100000_atomic_daily_quota.sql`
3. `supabase/migrations/20260813103000_atomic_lead_research_request_claim.sql`
4. `supabase/migrations/20260813110000_remove_legacy_negative_reply_suppressions.sql`
5. `supabase/migrations/20260813113000_inbound_reply_idempotency_privacy.sql`
6. `supabase/migrations/20260813120000_idempotent_enrichment_quota_operations.sql`

Apply all six to staging with cron jobs disabled. Reload and verify the PostgREST schema after each schema migration, then validate tables, constraints, RPC signatures, and grants. The gate must exercise draft, outbound quota, reconciliation, privacy, atomic research-request, inbound-ingestion, and enrichment-operation RPCs. It must also verify that the cleanup migration removes only `unsubscribed_emails` rows whose `reason` is `reply:negative` and preserves genuine opt-outs.

Any missing migration blocks the rollout. In particular, without the daily quota migration enrichment/research fails closed because `consume_antonia_daily_quota_v1` is unavailable, and without the atomic claim migration new research requests fail closed because the claim lifecycle RPCs are unavailable. After the gate passes, run smoke tests and only then enable cron jobs as a canary. App-first intentionally disables outbound sends (fail closed). Phase 7 supersedes the n8n draft guidance: do not enable either legacy n8n path. See `docs/deployment.md` for the complete release gate. This document does not assert that any migration or deployment has occurred.

### Phase 0: Operational safeguards

- Authenticate and scope `GET /api/lead-research/[reportId]`.
- Persist terminal poll results server-side.
- Make `ensureLeadResearchReport()` poll queued jobs and never cache queued envelopes as reports.
- Remove seller-company domain fallback from target-company identity.
- Stop person-report reuse by company domain or company name.
- Require semantic research readiness before enabling contact in opportunities.
- Fix or remove the nonexistent `/api/email/bulk-send` path before exposing opportunity bulk send.
- Authenticate the email render/restyle endpoints and the Firebase-to-app campaign generation request.
- Prevent dry runs from being recorded as sent.

These changes reduce current data leakage, false readiness, and duplicate-send risk without requiring the new contracts to be fully deployed.

### Phase 1: Contracts and adapters

- Implement strict Zod schemas and inferred TypeScript types in one shared package usable by the Next.js app and Firebase Functions.
- Implement canonical hashing, status mapping, freshness rules, and validation invariants.
- Replace internal normalization with `adaptLegacyResearchPayloadV1()` while preserving the current `LeadResearchReport` projection.
- Use existing compatibility fixtures as golden adapter tests.

### Phase 2: Split and persist

- Create immutable research snapshot and draft-version tables.
- Split each provider result into one snapshot and zero or more draft records.
- Continue legacy writes only as temporary projections.
- Store terminal poll results and return canonical IDs to clients.

### Phase 3: Consumer migration

- Migrate report UI to snapshot claims and evidence.
- Migrate email compose, bulk compose, Email Studio, LinkedIn, phone scripts, reconnection, mission fit, and autonomous replies to snapshot/draft IDs.
- Convert restyle, bulk edit, signature, and manual edits into child revisions.
- Remove direct UI reads from provider-specific `raw` fields.

### Phase 4: Outbound lineage

- Add optional draft metadata to current send APIs and event records.
- Persist an outbound dispatch before provider transmission.
- Reconcile unknown outcomes before retrying.
- Require exact approved content-hash matching for automated sends.
- Make draft ID and revision mandatory after every caller is migrated.

### Phase 5: Backfill and cutover

- Backfill server reports, opportunity reports, browser caches, and SUPL.IA reply drafts.
- Switch timeline, privacy export/deletion, and retention jobs to the new tables.
- Measure legacy reads and failed conversions.
- Stop dual writes after successful backfill and a defined compatibility window.

### Phase 6: Removal

- Remove `EnhancedReport`, canonical `raw` persistence, and `CrossReport.emailDraft`.
- Remove duplicate Firebase/Next.js normalizers.
- Remove company-name and domain fallback for person-level snapshots.
- Remove legacy browser keys and database projections after retention requirements are met.

## Evaluation Plan

### Contract and adapter tests

- Nested, flat, assistant-envelope, annotation, fenced JSON, truncated JSON, and n8n fallback fixtures.
- Invalid confidence, timestamps, URLs, duplicate IDs, dangling evidence, and illegal lifecycle states.
- Proof that snapshot output contains no subject, email body, talk track, call script, seller profile, or CTA.
- Legacy projection parity for overview, pains, signals, sources, drafts, and call scripts during migration.

### Safety and policy tests

- Company-domain reuse never copies person claims.
- Partial, stale, contradictory, low-confidence, or insufficient research cannot auto-send.
- Every factual span in automatic copy has a valid claim usage.
- Any edit invalidates approval and preflight hashes.
- Browser and server caches cannot cross user or organization scope.

### Concurrency and delivery tests

- Repeated research, generation, and send keys create one durable result.
- Compare-and-swap rejects conflicting draft revisions.
- Simulate failure before provider call, provider rejection, timeout after provider acceptance, persistence failure, and reconciliation.
- The persisted draft revision and content hash exactly match the content sent to the provider.

### Migration and privacy tests

- Read-once migration of array and versioned browser research caches.
- Conversion of browser draft override maps and malformed-data handling.
- Privacy export and deletion include snapshots, drafts, versions, dispatches, and lineage metadata.
- Next.js and Firebase workers use identical normalization and readiness rules.

## Acceptance Gates

- Zero unsupported factual claims in auto-send evaluation samples.
- Zero stale claims used by automatic sends.
- Zero duplicate sends under retry and timeout simulation.
- One hundred percent of automated sends reference an approved or policy-exempt draft revision.
- One hundred percent content-hash match between approved draft revision and provider payload before transport-only transformations.
- No person-level research reused through company-domain or company-name fallback.
- No unauthenticated polling of research jobs.

## Observability

| Signal | Dimensions |
| --- | --- |
| `research_requests_total` | provider, terminal status, cache outcome |
| `research_duration_ms` | provider, terminal status |
| `research_contract_failures_total` | error code, stage |
| `research_citation_coverage` | provider, status |
| `research_stale_claim_ratio` | claim kind |
| `draft_generation_total` | method, purpose, channel, status, prompt version |
| `draft_unsupported_claims_total` | purpose, channel |
| `draft_preflight_total` | status, issue code |
| `draft_revision_count` | purpose, channel |
| `send_attempts_total` | provider, outcome |
| `send_idempotency_replays_total` | provider |
| `send_unknown_outcomes_total` | provider |
| `legacy_adapter_reads_total` | source, detected shape |

Trace correlation should include research request ID, snapshot ID, draft ID and revision, dispatch ID, contacted-lead ID, and provider message/thread IDs.

Metric labels and logs must not contain message bodies, source excerpts, raw provider responses, recipient emails, access tokens, or API keys. Existing raw n8n and draft-body previews in worker logs should be removed or redacted before broader rollout.

## Historical n8n Validation Follow-up (Superseded)

The read-only inspection is complete for the graph, prompts, version distinction, latest successful output shape, and node-level error behavior at the time of audit. No n8n follow-up is required for the current runtime; these items remain only as an audit record:

- Obtain administrator-level workflow history only if an exact version-by-version audit is required. The current role could read the current saved version but not list historical revisions.
- Confirm the instance execution-retention and pruning settings with the n8n administrator.
- Add sanitized golden fixtures for both social and non-social branches without executing real searches or sending messages.
- Test malformed model JSON, empty evidence, SerpAPI failure, model refusal, timeout, and company-identity mismatch.
- Compare a normalized n8n fixture with `ResearchSnapshotV1` and `MessagingDraftV1` validation.

Any provider-specific field needed by the product must map explicitly to source, evidence, claim, messaging draft, or diagnostic extras. Unmapped raw fields must not become part of the canonical contracts.

## Recommended First Implementation Slice

Keep the first code change small and reversible:

1. Add shared Zod schemas for status, source, evidence, claim, `ResearchSnapshotV1`, and `MessagingDraftV1`.
2. Add a pure legacy adapter that returns `{ snapshot, drafts, legacyExtras }` and retain the existing report projection.
3. Add golden tests using the current `lead-research-contract.test.ts` fixtures.
4. Fix authenticated polling and terminal server persistence before switching any consumer.

This slice establishes the boundary and closes the largest persistence/security gap without requiring a UI rewrite or immediate database cutover.
