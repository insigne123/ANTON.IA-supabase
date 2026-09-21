# Research sequence preparation

## Model A/B experiment terra vs luna (2026-09-11, closed)

- Ran 10 production sequence jobs (5 snapshots x control routing / forced luna) through the real worker; 40 emails, all `review_required`, zero sends. Telemetry in `messaging_draft_generation_attempts` (43 rows, `native-draft/v15`, no rewrite contamination).
- Tokens: luna 20 attempts / 311K total / 100% first-pass; terra 23 attempts (3 `personalization_invalid` corrections) / 334K total / 67-82% first-pass. Input volume similar; price per token unknown so no USD conclusion.
- Blind judging by the owner (10 pairs, labels randomized): terra 7, luna 3. Below the pre-registered 50% bar, so the hybrid routing stays (priority A to terra, rest to luna, rewrites terra, editorial luna).
- Cheapest next saving without quality risk: eliminate terra's `personalization_invalid` corrections (~10% of sequence tokens).
- All temporary experiment code (`labModel`, `modelOverride`, lab UI selector, lab tests) removed; suite back to baseline and redeployed. Lab job rows remain in production as review-only drafts.

## Checklist

- [x] Read `plantillas-correo-grupoexpro_2.md` in full (six service lines, universal stages, role variants, annexes and caveats).
- [x] Research action queues preparation and opens a recoverable job URL.
- [x] Freeze a shared brief, seller and writing style before generating the initial email.
- [x] Generate initial + exactly three follow-ups through native drafting and Campaigns V2 reservations/batch/link persistence.
- [x] Durable stages, exclusive lease, heartbeat, stale recovery, bounded retry and manual resume.
- [x] Editorial review of all four current versions, separate from human approval.
- [x] Firebase scheduler bridge; no browser required for recovery.
- [x] Four visible slots, progress, saved preview and actionable errors.
- [x] Targeted tests, TypeScript and UI verification (record results below).

## Implementation and decisions

`research_sequence_preparations` stores a request keyed by organization, creator,
snapshot, style and instruction. Repeating the same request returns the same job.
The frozen context is committed before the initial model call. One worker turn
prepares the brief, initial draft, one missing follow-up, or the editorial review.
Drafts retain native preflight and pending approval. Campaign creation is deferred
only for this workflow; existing synchronous callers retain their behavior.

The four emails are initial, proof/application, second angle, and close. Cadence
offsets are 3/5/10 business days after the previous actual send (playbook days
4/9/19 with initial on day 1). No alternate recipient, LinkedIn touch, or automatic
sending is introduced. A template is selected from the seller offering, then
adapted to role and stage. Template brands, figures, guarantees, legal exemptions
and claims of previous contact are not factual sources.

UI problem: flow, feedback and component. Local reference:
`FirstContactFollowUpPlan.tsx`, existing card/button/progress primitives and the
repo visual system. Figcomponents was attempted but unavailable. The new surface
uses a single ordered list rather than four competing cards, semantic headings,
textual statuses, responsive wrapping and shared light/dark tokens. No external
assets, branding or typography copied.

## Operational requirements (not applied or deployed in this task)

1. Review and apply the single forward-only migration
   `20260912120000_research_sequence_preparations.sql` after its existing Campaigns
   V2 dependencies. It enables RLS and exposes no direct client privileges.
2. Verify the table, grants/RLS and logs; deploy the app and
   `researchSequencePreparationTick` with the existing `FIREBASE_SCHEDULER_SECRET`.
3. Existing organizations must have Campaigns V2 enabled. The API reports an
   explicit error otherwise; this task does not change production flags.

`after()` on POST/GET is a latency optimization, not the recovery mechanism. The
minute scheduler uses the same secret-authenticated Firebase bridge pattern as
other workers. Each invocation processes one oldest due job; progress rotates it
behind already waiting jobs. Four failed attempts at a stage stop automatic
retry; manual retry resets that stage without discarding existing drafts.
Editorial issues are retained for editing in the existing compose workspace.
The review records all version IDs and is invalidated in the view if copy changes.

## Verification

- Targeted drafting/worker/sequence/scheduler tests: 65 passed.
- Full `npm run test:unit`: 1267 passed, zero failures.
- App `tsc --noEmit` and Functions `tsc --noEmit -p functions/tsconfig.json`: passed.
- `node --test scripts/research-sequence-browser.test.mjs`: passed in Chrome headless with mocked API responses. Covers four slots, partial progress, retry, reload recovery, editorial feedback, keyboard focus and secondary-text contrast in light/dark, widths 320/380/768/1280.
- `git diff --check`: passed.
- These checks do not evaluate live model writing quality or execute the migration. Live end-to-end generation and production activation remain pending.

## Production activation and live evaluation

- Applied the preparation-table migration using the production MCP. Verified RLS enabled, anon SELECT denied, authenticated INSERT denied, service_role UPDATE allowed and the due index present.
- App Hosting `studio` rollout completed; explicitly built Functions and deployed `researchSequencePreparationTick` successfully.
- Health endpoint returned 200; unauthenticated sequence access returned 401. Secret-authenticated worker POST returned 200 with `processed: 0` (empty queue).
- Cloud log retrieval failed due to credentials; gcloud reports reauthentication required. Scheduled invocation logs remain unverified.
- Ran `scripts/evaluate-live-sequence.ts` with the real configured OpenAI provider on a synthetic Claudia/Randstad/Yago context derived from the user's supplied wording. Credential stayed in process memory; no database writes or email sends.
- All four outputs passed factual preflight, but editorial evaluation by inspection FAILED: each repeats the same information-centralization application, and the closing message repeats the pitch and meeting CTA. This is not evidence that writing quality is solved. The fixture intentionally has a narrow seller offer; richer authorized offer context and stage-specific closing behavior need further work.
- The live check verifies model execution, not a full authenticated browser-to-worker production sequence. No production recipient was enrolled for this evaluation.

## Per-step CTA and user steering (native-draft/v15)

- Initial keeps the approved CTA appended by the server. Follow-ups write their own single closing question with the configured minutes (validated: one question, minutes present, no links, no verbatim approved text). The closing step carries no meeting CTA at all.
- The model-written closing question is exempt from quantity checks exactly like the approved text: a proposed duration is not a factual claim.
- The sequence page offers "Pedir otra versión a la IA": a free instruction that enqueues a new preparation with the same snapshot and style. The view echoes both IDs for this purpose.
- Live re-evaluation on the synthetic Claudia/Randstad/Yago context: initial ends with the approved CTA, follow-ups ask "¿Te acomoda conversar 15 minutos sobre este alcance?" and "¿Te tinca conversarlo 15 minutos?", the close ends with "Dejo el tema abierto." All four pass factual preflight. Variety confirmed; offer depth still depends on the seller profile.
