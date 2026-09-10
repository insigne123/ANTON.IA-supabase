# Report V2: Luna-only requests and compact context

## Implemented behavior

- Research and report model requests use only `gpt-5.6-luna` at every tier. HTTP failures, rate limits and invalid output never escalate to Terra, Sol or Astra. Existing bounded repairs remain; there is no alternate-model fallback.
- Prompt context uses compact JSON tables (`columns` and ordered `rows`) when shorter than repeated objects. All records, short claim IDs, evidence/source references, exact passages, scope, jurisdiction, dates, confidence and derivation assumptions remain. Internal metadata keys are omitted; UUIDs occurring inside evidence text are not rewritten. The persisted contracts are unchanged.
- One specialist request receives the compact context once and returns independent `company`, `contact` and `sector` blocks. The response budget remains 7,500 tokens, equal to the previous three 2,500-token budgets; actual consumption is measured, not assumed.
- Public research reads up to eight pages with at most six searches and three concurrent fetch/extraction requests. HTTP requests validate DNS, pin the destination, revalidate redirects, limit response size, and enforce timeouts.
- Extraction preserves model output, evergreen facts without event dates, and company/group/country scope. Retrieval or page publication dates are not automatically event dates.
- A commercial analyst integrates the three fused briefs; one editor writes the report; an independent review checks the actual evidence, imported context, and seller offer. There are four successful editorial calls without repair, not six. Shared specialist telemetry is counted once.
- The initial editor receives analysis-referenced claims, linked signals, transitive derivation inputs and the company/contact factual backbone (overview, industry, services, geography, role and tenure). Analysis has no company narrative field, so deleting every unreferenced company claim would degrade its profile. IDs, order, scope, evidence references, formulas and assumptions remain unchanged. Missing/unresolved references conservatively retain the full index. Repair and audit always retain the full graph; the editor cannot cite an omitted claim.
- Recommendations, profile context and role-based analysis do not require decorative citations. Facts still require appropriate support. Optional news, legal form, committee names and volume estimates do not gate editorial completion.
- Missing core prose is a retryable failure. One targeted repair receives the concrete review findings. Unresolved cited factual disputes block delivery, preventing rejected evidence from resurfacing in the evidence graph or drafts.
- Core-section coverage measures presence, not factual accuracy or commercial quality.
- The application links report-owned evidence and preserves the distinction between analysis and sourced content. Existing draft contactability, freshness, approval and delivery restrictions remain intact.
- Successful public research can be checkpointed for 24 hours using existing artifact RPCs. Cache identities include snapshot, owner, organization, context and research version. Shared cache payloads exclude imported personal profiles, seller profiles, qualification and private queries.
- Cache hits rebuild the contact context from the current scoped snapshot; enriched entity paths are not cached. Separate contacts do not share full report research checkpoints.
- Production report generation reevaluates ICP against final entity and unambiguous explicitly local headcount. No schema migration is required.

## Recorded live evaluations

The following are HISTORICAL evaluations of the previous Luna/Terra prompts, not validation of the current Luna-only compact prompts. All used real OpenAI API calls limited to Luna and Terra. Production was read only to obtain the already-authorized Bruno context. Reports were exported locally, with no sends or rollout changes.

| Case | Input | Result | Wall time | Estimated successful model calls cost |
| --- | --- | --- | --- | --- |
| Bruno, GrupoExpro Peru | Fresh public research: 5 searches, 8 pages, 41 retained claims | Complete, one nonblocking literal-copy warning | 131 s | USD 0.1662 |
| Finance director | Simulated role; replay of same company evidence | Complete, review passed | 75 s | USD 0.1626 |
| Technology director, second iteration | Simulated role; replay of same company evidence | Complete, two nonblocking wording warnings | 82 s | USD 0.1575 |
| Bruno, profile only, second iteration | No web claims; imported company and contact context | Complete, explicit no-web limitation | 65 s | USD 0.0893 |

Costs are estimates from recorded successful token usage, including reported cache-write tokens. They exclude search, hosting, failed requests and billing adjustments. Role simulations are not additional researched real contacts or evidence of generalization across companies.

Observed differentiation: recruitment reports propose candidate queries, document follow-up and internal knowledge; finance reports focus on billing support, collections and exceptions; technology reports focus on integration, permissions, knowledge access and support. Earlier technology/profile-only runs exposed missing auditor context; the affected cases were rerun after the fix.

## Review command

Node 22 is required. This operational review is not a production test suite. The script itself does not load `.env.local` and never writes to the database or invokes delivery workers. For the two replays below, the user explicitly authorized Node's `--env-file=.env.local`; that exception applies only to this operational CLI, never to tests. No keys were read, printed or modified. No Supabase URL was changed.

```powershell
node --loader ./scripts/ts-test-loader.mjs scripts/review-report-v2.ts --production-read-only --allow-paid-calls --organization <organization-uuid> --user <owner-uuid> --lead <lead-uuid> --output <local-directory>
node --loader ./scripts/ts-test-loader.mjs scripts/review-report-v2.ts --replay <existing-review-directory> --allow-paid-calls --role "Director de Finanzas" --output <local-directory>
node --loader ./scripts/ts-test-loader.mjs scripts/review-report-v2.ts --replay <existing-review-directory> --allow-paid-calls --profile-only --output <local-directory>
```

Exports include the report Markdown, structured result, source graph, model usage, specialist briefs and editor/auditor attempts. These files contain lead information: retain locally under controlled access and never commit raw review output.

## Offline inspection and earlier replay instructions

Executed with Node 22.23.2, without loading `.env.local`, paid calls or production access. No credentials are required:

```powershell
node --loader ./scripts/ts-test-loader.mjs scripts/review-report-v2.ts --replay "C:\Users\nicol\AppData\Local\Temp\opencode\bruno-luna-terra-20260908-2" --inspect-context
```

Inspection prints only sizes and policy, performs no network requests and writes no files. Claims: 14,506 to 8,779 JSON bytes (39.5% smaller); facts: 29,555 to 22,256 bytes (24.7% smaller). The baseline is raw saved JSON. Prior analyst/editor prompts already removed internal metadata; `metadataOnlyBytes` and `tableSavedPercent` separate that preexisting saving from table compression. These are input component sizes, not full prompt token counts, billed cost savings or model quality scores. Uncited passages remain available to the auditor, including possible contradictions. No audit requirement was relaxed.

The earlier pending command below is retained as historical context. The authorized paid evaluations have now run in different unique directories, recorded in the next section. Replay uses local snapshot/configuration/research files, with no Supabase reads or writes and no fresh searches; only model API requests and local exports:

```powershell
node --loader ./scripts/ts-test-loader.mjs scripts/review-report-v2.ts --replay "C:\Users\nicol\AppData\Local\Temp\opencode\bruno-luna-terra-20260908-2" --allow-paid-calls --output "C:\Users\nicol\AppData\Local\Temp\opencode\bruno-luna-only-compact-20260908"
```

The output must differ from the input directory. Before executing, verify the output parent and supply provider credentials through the environment. Compare factual accuracy, group/local scope, exact citations, role-specific utility, repair frequency and recorded token usage against the historical report. A separate Luna auditing call is not model diversity; correlated writer/auditor errors remain a risk. Existing extraction/identity input bounds are unchanged; this compression adds no text or record truncation.

## Release status and limits

The implementation is connected in application code but has not been deployed or enabled by this work. The rollout remains off. Durable cache/persistence paths are covered with mocked RPCs, not a production write exercise. No visual browser audit or full deployed queue-to-UI validation has been completed.

Only one real company has been evaluated end to end. Before broad automatic use, validate additional companies and sectors, the deployed queue's request lifetime/concurrency, and the rendered experience on mobile/light/dark. A complete document and a passing model review are not guarantees of factual accuracy.

## Cost optimization validation, 2026-09-08 session

The machine recorded the two new reports at 2026-09-09 01:59 and 02:00 UTC. Both used Node 22.23.2 and the existing local 41-claim, eight-source graph. Historical `researchMetrics` (five queries, eight pages, 61,641 ms) were replayed metadata, NOT new searches, pages fetched or time spent researching. Exactly two paid CLI replays ran; no production reads, writes, sends, migrations, commits or deployment were performed.

| Editorial replay | Successful calls | Input tokens | Output tokens | Wall time rounded | Estimated USD | Status / AI audit | Repairs |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Previous Bruno Luna-only compact (`bruno-luna-only-compact-20260908-3`) | 6 | 36,259 | 6,639 | 53 s | 0.01703065 | completed / warning: literal_copy | 0 |
| Bruno fused specialists + selected editor claims | 4 | 28,579 | 5,834 | 51 s | 0.01414495 | completed / passed | 0 |
| Existing simulated Finance Director, fused | 4 | 28,271 | 5,806 | 51 s | 0.01403435 | completed / passed | 0 |

Bruno input decreased 21.2%, output 12.1%, and estimated successful-call cost 16.9% (USD 0.00288570). This is one paired observation, not a forecast. Finance has no directly comparable prior Luna-only compact replay; its historical Luna/Terra report is only a qualitative comparison. Total estimated cost of the two new replays: USD 0.02817930.

Internal rates used by the CLI: USD 0.20 per million input tokens, USD 1.20 per million output tokens, cache-read multiplier 0.1 and cache-write multiplier 1.25. These are internal pricing assumptions, NOT an official provider bill. Estimates include reported successful-call cache writes but exclude failed attempts, search, hosting and billing adjustments; they are NOT complete research costs. Bruno's four calls reported no cache-read tokens. No saving is inferred just from the call count.

Both initial editor contexts retained 40/41 claims (only `c39` omitted). The conservative company backbone deliberately limits savings on this service-heavy graph. The audit still had all 41 claims and every passage, including uncited or potentially contradictory material. Its prompt, model policy, deterministic checks, blocking rules and repair criteria were not relaxed or changed in this task.

### Manual quality comparison

- Bruno preserves three concrete recruitment opportunities: internal knowledge retrieval, interview/document coordination and candidate assistance. The report distinguishes the coordinator's functional influence from purchasing authority, asks six role-specific questions and retains human review, permissions and data controls. No local headcount or current buying urgency is invented in the prose.
- Compared with the historical Luna/Terra baseline, Bruno's pilot metrics are less explicit per opportunity; the earlier report separately specified first-response time and document completeness. The new version remains actionable but a passed audit does not establish equal commercial quality.
- Finance differs from recruitment in financial reporting, cost centers, consolidation, control and closing-speed questions, and explicitly keeps the 12,000-person figure at holding/global scope. However, its opportunities drift more toward HR/operations than the historical finance baseline, which focused on billing, collections and exceptions. This is a personalization weakness, not evidence of equivalent quality across roles. No third paid replay or unvalidated prompt tuning was performed after observing it.
- The new Bruno opening says the seller is already conversing with recruiting teams; the saved offer does not establish that activity. Treat that suggested wording as requiring seller confirmation, not a verified fact. The historical baseline also used an unsupported seller-activity formulation. The model auditor did not flag this; a separate call to the same model does not remove correlated errors.
- Source lists and claim appendices are unchanged and still contain historical extraction ambiguities. Passing review is not independent verification of every upstream fact. This remains a candidate implementation, not approval for broad automatic delivery.

### Deferred optimizations and security boundaries

- Rollout-independent content caching is intentionally NOT implemented. `seller-profile.ts` includes mode in `synthesisContextHash`; `tryEnsureResearchReportDocumentV2` also requires matching delivery state. The existing SQL in `20260908173355_report_v2_foundation.sql` only claims queued/retryable work (lines 574-599) and binds persistence to a running claim or an exact same-delivery idempotent result (lines 709-740). Removing mode alone can leave completed suppressed content unclaimable on promotion; removing the visibility check risks returning it as deliverable. A safe change needs an explicit atomic delivery transition with fresh authorization/rollout checks, durable document binding and concurrency/revocation tests. No ad-hoc update, migration or production experiment was added.
- Cache identities continue to isolate snapshot, owner, organization, seller/ICP context, contact, domain, country, language and research version. Public cache payloads and TTL are unchanged. Approval, contactability, freshness and visible/suppressed delivery guards are unchanged.
- Conditional specialist omission is NOT enabled: neither `shallow` nor absent web claims establishes redundancy, since role/sector reasoning still adds useful context. There is no existing validated same-context specialist artifact to reuse. Keep the fused call rather than introduce a speculative quality-reducing gate.
- Deterministic-only audit is NOT enabled. Even profile-only recommendations can contain unsupported company facts, authority or seller claims, and equivalence with evidence review has not been demonstrated.

### Verification

- `npm run test:unit`: 926 passed, zero failed/skipped, approximately 60.6 s. The existing runner uses an allowlisted environment with `NODE_ENV=test`, `APP_ENV=test`, external side effects false and delivery disabled; no provider credentials or `.env.local` inherited.
- `scripts/review-report-v2.test.ts`: four CLI negative tests passed under a separately allowlisted test environment. No paid calls or exports from that suite.
- `npm run typecheck`: passed, including the final CLI token/context telemetry changes.
- `git diff --check`: passed (only existing Windows LF/CRLF notices). The final specialist edit after verification was indentation only.
- New positive/negative tests cover fused blocks, one-call/one-telemetry accounting, Luna-only policy, incomplete/failed responses, valid/invalid citations, derivation closure/cycles, signals, corporate backbone, missing references, omitted citation rejection, full repair context, cache-hit identity and delivery misses, owner/organization rejection and visible-only scoped reads. Existing checkpoint, worker, audit, synthesis and draft-security tests also passed in the full suite.

### Local artifacts

Output parent verified with `Test-Path` before each replay. GUID directories prevent collisions; private raw outputs remain outside git.

- Bruno: `C:\Users\nicol\AppData\Local\Temp\opencode\bruno-luna-fused-20260908-5e2d8274786b45c1bcf39a5a4ca0442b\report.md`
- Finance: `C:\Users\nicol\AppData\Local\Temp\opencode\finanzas-luna-fused-20260908-0538dcbce2444b4d80b63c8341561658\report.md`
- Each directory includes `result.json`, `model-calls.json`, `editor-context-1.json`, `specialists.json`, `analysis.json`, `editor-1.json`, `audit-1.json` and local input copies. The CLI now records selected claim IDs and aggregate input/output tokens explicitly.

Commands used: `node --env-file=.env.local --loader ./scripts/ts-test-loader.mjs scripts/review-report-v2.ts --replay <local-input> --allow-paid-calls --output <unique-directory>`; finance additionally used `--role "Director de Finanzas"` with the preexisting `report-v2-finanzas-20260908` input. Bruno used `bruno-luna-terra-20260908-2` as its evidence input.

## Quality regression correction, 2026-09-09 UTC

This follow-up supersedes the earlier candidate quality observations for the current prompts, while retaining the earlier artifacts and measurements. All prior workspace changes were preserved on `main`. No commits, deployments, Supabase access, environment-file changes or production writes occurred.

### Minimal changes

- Specialist version `/4`: removed the recruiting-centric instruction to propose cases different from a finance director even when the actual contact WAS a finance director. The fused contact block now branches conceptually by role: Finance/CFO explores billing, collections, closing and financial/documentary exceptions; recruiting explores candidates, interviews and files; IT explores integrations, permissions and support. Cases must fit the available evidence and real seller offer, and remain hypotheses, not confirmed internal problems. Still one request with three blocks.
- Analyst version `/5`: preserves process, bounded pilot, an individual measurable criterion and validation question for each opportunity inside the existing `fitByProduct.rationale`. Finance must not be replaced by HR onboarding or generic reporting; operations/HR can provide inputs to a financial process.
- Editor version `/5`: each fit opportunity gets its own paragraph, pilot and metric specifying what to measure and a unit/comparison to baseline. No invented baseline numbers or promised savings. Initial openings must use declared capabilities and exploratory questions, not invented seller experience, traction, customers, ongoing conversations or results. The rule also applies inside quoted suggestions and `basis=recommendation`.
- Audit version `/6`: explicitly checks seller assertions against seller context, including suggested openings. Unsupported experience, traction or results are material `hard_hypothesis` blocks, not style warnings. Lack of role specificity or individual pilot measurement is surfaced under existing `generic` warnings; this does not downgrade material factual issues. All earlier evidence, citation, jurisdiction and blocking checks remain.
- Existing specialist opportunity strings, editor paragraph text and audit issue type schemas gained descriptions carrying these requirements into structured-output generation. No new stored fields or issue enum, migration, extra default call, output-budget reduction or weaker review rule was added. Prompt version changes automatically update the application's existing runtime identity.

### Proportional verification

Node 22.23.2. Selected nine test files: specialists, analyst, editor, audit, synthesis, compact context, model policy, scoped document persistence and operational CLI guards. **54 tests passed, zero failures/skips**, in approximately 17.7 s. Tests ran with an explicit allowlisted environment, `NODE_ENV=test`, `APP_ENV=test`, external side effects false and delivery disabled. No `.env.local` was loaded in tests. `npm run typecheck` passed. The full suite was not repeated because the previous complete run had passed and this follow-up changes only prompts/schema descriptions and their regression tests.

New deterministic regression cases assert role/pilot/seller instructions in actual generated prompts and schema descriptions; preserve source-free hypotheses and proposed measurements; retain located material seller blocks even inside recommendation paragraphs; admit supported seller activity and neutral capabilities; and verify one targeted repair followed by withholding an unresolved invented opening. These are mocked model-output/contract tests, NOT proof of semantic model detection accuracy. The existing one-request specialist and one-editor/one-auditor happy path tests remain green.

### Two authorized paid replays

Exactly two additional operational replays ran after tests, with explicit `--env-file=.env.local --allow-paid-calls`. Input remained the saved 41-claim/eight-source company graph, not fresh research. Bruno used `bruno-luna-terra-20260908-2`; Finance used `report-v2-finanzas-20260908` with `--role "Director de Finanzas"`. Each output parent was verified with `Test-Path` and each output directory includes a fresh GUID. No credentials were read or printed; replay performed no Supabase reads or writes.

| Current replay | Successful calls | Input tokens | Output tokens | Rounded time | Estimated USD | Status / AI audit | Repairs |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Bruno, role/metric/seller correction | 4 | 29,989 | 6,344 | 56 s | 0.01510945 | completed / passed | 0 |
| Finance, role/metric/seller correction | 4 | 29,847 | 6,542 | 58 s | 0.01531155 | completed / passed | 0 |

Against the first fused replays, Bruno input rose 4.93%, output 8.74%, cost 6.82%; Finance input rose 5.57%, output 12.68%, cost 9.10%. This is the observed cost of the follow-up prompts and generated text, not an isolated causal estimate. Against the prior Bruno compact six-call replay, the corrected Bruno still uses 17.29% less input, 4.44% less output and costs an estimated 11.28% less, but took 56 s versus 53 s. There is no prior compact Luna-only Finance baseline from which to infer equivalent savings.

Estimated total for these two additional replays: **USD 0.03042100**. Same internal rates as above (input USD 0.20/M, output USD 1.20/M, cache-read x0.1, cache-write x1.25), not official billing or complete research cost. Successful recorded calls only; search, hosting and failed attempts excluded. No saving is claimed merely because the pipeline has four calls. The initial editor kept 39/41 claims for Bruno and 41/41 for Finance; auditor retained the complete graph in both cases.

### Observed quality and remaining limits

- Bruno has three recruiting-specific opportunities, each with bounded scope and explicit baseline comparison: candidate queries (minutes per response and resolution percentage), interview coordination (hours to confirmation and reschedules per candidate), and selection files (minutes per file and corrected fields). The opening offers actual documented capabilities and asks about the process without claiming existing customers, experience, conversations or savings. Authority, local/global scope and human review remain qualified.
- Finance now focuses on reconciliation between service evidence and billing, collection-file preparation, and documentary support for financial closing. Metrics are tied to each case: minutes per file and exception count; completeness on first submission and preparation minutes; consultation time and percentage of answers with verifiable sources. HR/operations supply evidence rather than replacing the finance use case. This corrects the previous drift toward HR onboarding and generic reporting in this sample.
- Both new audits returned zero issues and required no repair. Manual reading found the three targeted regressions corrected in these samples: role specialization, individual pilot metrics and invented seller traction. The evidence still supports business context, not proof that the proposed internal problems exist; the opportunities use conditional or exploratory language.
- Residual wording: Finance's opening asks where exceptions or missing documents occur most frequently, and its second discovery question asks where differences occur. These questions still presuppose some friction instead of first asking whether it exists. This is less neutral than ideal, even though the opportunities are conditional and do not assert an actual incident. The auditor did not flag it. A neutral formulation would first ask whether there are exceptions, then where they occur. No further prompt change or third paid replay was made after these two evaluations.
- This establishes improvement on the observed regressions, NOT general quality equivalence or a zero-hallucination guarantee. Only one company and one simulated additional role were evaluated. There was no paid adversarial audit of the old fabricated seller sentence: its blocking contract is regression-tested with mocked output, while the live replays tested clean openings. Same-model writer/reviewer correlation, upstream extraction ambiguities and nondeterministic outputs remain limitations. Cache/delivery decoupling and specialist omission remain deferred as previously documented.

### Current artifacts

- Bruno report: `C:\Users\nicol\AppData\Local\Temp\opencode\bruno-luna-quality-20260909-0876b13ec4df4605aa02e9751249e3aa\report.md`
- Finance report: `C:\Users\nicol\AppData\Local\Temp\opencode\finanzas-luna-quality-20260909-c591c4f1f80f4e4ea8840c5b495f4780\report.md`
- Both directories contain `result.json`, `model-calls.json`, `editor-context-1.json`, `specialists.json`, `analysis.json`, `editor-1.json`, `audit-1.json` and local input copies. Report timestamps: 2026-09-09T02:09:45.367Z and 2026-09-09T02:11:00.851Z respectively. Raw private artifacts remain outside the repo.
