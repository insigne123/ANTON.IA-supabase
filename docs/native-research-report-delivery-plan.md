# Native Research, AI Report and Initial Email Delivery Plan

## Objective

Deliver one reliable production flow:

1. Collect attributable public evidence about the person and company.
2. Build and persist an immutable canonical research snapshot.
3. Use AI to synthesize a substantial person-and-company report whose factual blocks cite the snapshot.
4. Use that validated report and its evidence to create an initial email draft.
5. Open the draft for human review. Never send automatically.

## Non-negotiable rules

- Never present imported profile fields as researched facts.
- Never persist model-generated facts without canonical claim and evidence references.
- Never weaken privacy, tenant scope, snapshot integrity, freshness or outbound approval controls.
- Never create or send an email as a side effect of research or report synthesis.
- A hypothesis must remain visibly and structurally different from a verified fact.
- A failed report or draft must expose an actionable reason and preserve the last valid artifact.
- Historical snapshots remain immutable. Refresh creates new jobs and snapshots.
- Do not mark a phase complete until its tests and production checks pass.

## Delivery sequence

### Phase 1: Email generation hotfix

Goal: make the existing ready report reliably create a reviewable draft.

- Return structured preflight issues from `POST /api/native-drafts`.
- Surface the first actionable issue in both research entry points.
- Validate the approved CTA by exact occurrence and detect extra CTA language only outside that exact CTA.
- Have the model generate the message body without the CTA; append the approved CTA exactly once on the server.
- Keep the 60-180 word limit, exact provenance, placeholder, duplication and hypothesis checks.
- Add regression tests for custom CTA text, extra questions, corrective generation and structured errors.

Exit criteria:

- A valid GrupoExpro snapshot creates a persisted lifecycle `draft` and opens compose.
- Invalid output returns its exact validation issue.
- No dispatch is created.

### Phase 2: Evidence collection improvements

Goal: collect enough distinct material for a useful report.

- Add exact public person search using name plus company and role.
- Require person identity matching before creating person evidence.
- Expand official-company extraction into focused overview and service facts.
- Keep news, hiring and public mentions as dated signals.
- Preserve imported person/company context separately.
- Assess report completeness separately from minimum email draft eligibility.

Exit criteria:

- A deep GrupoExpro run has company evidence plus person evidence when a matching public source exists.
- A name collision cannot produce a person claim.
- Missing person evidence is represented honestly as a gap.

### Phase 3: AI report document

Goal: create the actual report requested by the product.

- Add a strict `ResearchReportDocumentV1` schema.
- Include executive summary, person, company, signals, commercial hypotheses, gaps, contradictions and an outreach brief.
- Require claim and evidence IDs for every factual block.
- Validate all citations against `ResearchSnapshotV1` after model output.
- Persist the report document tenant-scoped and linked to its snapshot, with content hash, model and prompt version.
- Keep a deterministic evidence projection as fallback, but never label that fallback as an AI-complete report.
- Add explicit synthesis status so collection and report generation are not conflated.

Exit criteria:

- Unknown citations and uncited factual blocks are rejected.
- A valid report can be loaded independently from run polling.
- Synthesis failure is retryable and does not corrupt the snapshot.

### Phase 4: Email from the report

Goal: make the report the direct input to outreach generation.

- Extend the draft context with the validated report outreach brief.
- Resolve the brief back to canonical claims and evidence.
- Let the model use only approved factual anchors and explicitly hedged hypotheses.
- Persist exact claim, evidence and source usage for the generated draft.
- Keep human review, immutable revision and approval requirements.

Exit criteria:

- The email visibly uses a report-backed company or person fact.
- The generated draft passes preflight and retains provenance.
- Editing invalidates prior approval and sending remains a separate explicit action.

### Phase 5: Report experience

Goal: make the result read like a useful professional report rather than a source dump.

- Render a concise executive brief first.
- Separate imported person profile from publicly verified person facts.
- Group company overview, offerings, market/industry and scale.
- Show dated public signals and clearly labeled commercial hypotheses.
- Show gaps and contradictions without internal implementation language.
- Display independent counts for claims, evidence records and unique sources.
- Keep sources and detailed quality under progressive disclosure.
- Keep one sticky contextual CTA: create draft, refresh research or fix missing email.
- Preserve full-height scrolling, keyboard focus, mobile drill-in and light/dark hierarchy.

Exit criteria:

- The first viewport explains who the lead is, what the company does, why contact may be relevant and what action is available.
- Every factual statement opens its evidence.
- Mobile has no horizontal overflow or nested-scroll trap.

### Phase 6: Verification and rollout

- Run focused unit and integration tests after each phase.
- Run the full test suite, lint, typecheck, Functions build and clean Next production build.
- Apply tenant-safe migrations and run Supabase security/performance advisors.
- Deploy App Hosting and only redeploy Functions if their source changed.
- Reprocess the three GrupoExpro leads with refresh enabled.
- Verify report document content, citations, quality and UI status.
- Create exactly one test draft only after explicit end-to-end validation; do not send it.
- Verify draft and dispatch counts before and after the smoke test.

## Primary files

- `src/lib/server/native-research.ts`
- `src/lib/research-contracts.ts`
- `src/lib/native-research-contracts.ts`
- `src/lib/research-workspace.ts`
- `src/components/research/NativeResearchReport.tsx`
- `src/lib/server/draft-context-v2.ts`
- `src/lib/server/draft-preflight-v2.ts`
- `src/lib/server/native-drafts.ts`
- `src/ai/flows/generate-outreach-from-report.ts`
- `src/app/api/native-research/[reportId]/route.ts`
- `src/app/api/native-drafts/route.ts`
- `src/app/(app)/saved/leads/enriched/Client.tsx`
- `supabase/migrations/*`

## Definition of done

- Research, report synthesis and draft creation are three explicit observable stages.
- GrupoExpro no longer produces a one-paragraph report marked as comprehensive.
- The report contains useful person and company sections, or clearly states what could not be verified.
- `Crear borrador y revisar` succeeds for an eligible report.
- Failures show a specific recovery action.
- No automatic send path is introduced.
- All verification commands and production smoke checks pass.
