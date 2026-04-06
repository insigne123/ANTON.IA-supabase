# ANTONIA Autopilot Roadmap

## Goal

Convert `ANTONIA` from a mission runner into a true commercial autopilot for outsourcing B2B, so a team can leave the app working with controlled autonomy and come back to qualified conversations, prioritized opportunities, and clear next actions.

## Current foundation already in the repo

- Mission model with configurable limits: `src/lib/services/antonia-service.ts`
- Background queue with tasks, retries, scheduling and observability columns: `supabase/migrations/20260206000000_antonia_observability.sql`
- Main worker loop with chaining `SEARCH -> ENRICH -> CONTACT -> REPORT`: `src/app/api/cron/antonia/route.ts`
- Alternate Firebase worker still present: `functions/src/antonia-worker.ts`
- Mission intelligence and auto-tuning suggestions: `src/app/api/antonia/missions/[missionId]/intelligence/route.ts`
- Reply classification and positive intent detection: `src/app/api/tracking/webhook/route.ts`, `src/app/api/replies/classify/route.ts`
- Reports and notifications: `src/lib/services/notification-service.ts`

This means the base for autopilot already exists. The next step is not starting from zero. It is turning isolated automation into a closed-loop operating system.

## Target operating model

An organization should be able to configure:

1. ICP and vertical focus
2. Offer and value proposition
3. Sending channels and quotas
4. Guardrails and approval rules
5. Outcome goal: meetings, conversations, proposals, pipeline

Then `ANTONIA` should continuously:

1. Search accounts and leads
2. Score and prioritize them
3. Enrich and research only when worth it
4. Launch first touch and follow-ups
5. React to opens, clicks and replies
6. Pause risky sequences automatically
7. Push hot leads to CRM and next action queues
8. Report results and tune itself

## Top 15 prioritized improvements

| # | Initiative | Impact | Effort | Why it matters |
|---|---|---|---|---|
| 1 | Outcome-based autopilot setup | High | Medium | Missions today are parameter based; autopilot should start from goals like "book 10 meetings with HR leaders in retail Chile". |
| 2 | Autopilot modes and guardrails | High | Medium | Users need trust controls: observe, semi-auto, full-auto, plus approval thresholds before sending. |
| 3 | Lead and account scoring engine | High | Medium | The app needs to decide who deserves enrich, research, contact and follow-up first. |
| 4 | Inbox triage and next-best-action engine | High | Medium | Reply detection exists, but the system still needs to turn intent into actions, owners and CRM moves. |
| 5 | Unified funnel state model | High | Medium | Search, saved, enriched, contacted and CRM are still too split for a "leave it running" experience. |
| 6 | Automatic campaign and message selection by playbook | High | Medium | Outsourcing needs vertical playbooks, not generic campaigns. |
| 7 | Adaptive budget allocator | High | Medium | ANTONIA should rebalance search, enrich, investigate and contact quotas based on results. |
| 8 | Risk and deliverability autopilot | High | Medium | Full automation without domain warmup, unsubscribe discipline and bounce controls is dangerous. |
| 9 | Exception queue and rescue center | High | Low | Operators need one place for blocked, failed, ambiguous or approval-required items. |
| 10 | CRM timeline and action orchestration | High | Medium | Hot leads should automatically create tasks, stage moves and meeting actions. |
| 11 | Calendar booking and meeting capture | High | Medium | Positive replies should end in booked meetings, not just notifications. |
| 12 | Self-healing worker architecture | High | High | There are two worker paths today; full autopilot needs one reliable control plane. |
| 13 | Executive autopilot reporting | Medium | Low | Teams need daily/weekly business reports with meetings, replies, pipeline and blockers. |
| 14 | Vertical benchmarks for outsourcing | Medium | Medium | This becomes a product differentiator: best persona, best channel, best sequence by vertical. |
| 15 | Pricing and packaging by automation tier | Medium | Low | Strong monetization path: assisted, autopilot, and enterprise control modes. |

## What I would build first

### Phase 1 - Make autopilot trustworthy

1. Autopilot modes: `manual assist`, `semi auto`, `full auto`
2. Approval rules:
   - approve first message per new playbook
   - auto-send only above score threshold
   - pause on negative signals or high failure rate
3. Exception inbox for:
   - no email found
   - blocked domain
   - unsubscribe
   - ambiguous positive reply
   - repeated send failure
4. Unified lead state model across search, enrichment, contact and CRM

### Phase 2 - Make autopilot smart

1. Lead/account scoring
2. Playbook selector for outsourcing verticals
3. Auto-tuning of quotas and search breadth
4. Next-best-action engine powered by engagement + reply intent + CRM stage
5. Research depth by opportunity value, not flat rules

### Phase 3 - Make autopilot outcome-driven

1. Calendar booking and meeting creation
2. Automatic stage movement to `meeting`, `proposal`, `stalled`, `do_not_contact`
3. Pipeline and meeting KPIs in dashboard
4. Weekly executive report with business impact
5. Benchmarking by vertical and persona

## Product requirements for a real full-auto mode

To let customers leave the app working, I would treat these as mandatory:

- Hard daily caps by org, mission and channel
- Human approval thresholds
- Automatic pause rules on failure spikes
- Unsubscribe and blocked domain enforcement
- Real task heartbeats and stuck-task rescue
- Full task audit trail per mission and lead
- Hot-reply escalation in less than 5 minutes
- Single worker source of truth
- Business-hour scheduling by lead timezone
- Clear explainability: why ANTONIA contacted, paused or escalated a lead

## Recommended backlog by impact/effort

### Highest ROI in 30 days

1. Add autopilot mode selector and guardrails
2. Ship a central exception queue
3. Add score field to prioritize who gets contacted
4. Promote mission intelligence from suggestion to auto-tuning with approval
5. Unify lead stages across `leads`, `enriched_leads`, `contacted_leads` and CRM views

### Highest product impact in 60-90 days

1. Build outsourcing playbooks by vertical
2. Add next-best-action orchestration after reply classification
3. Create calendar booking path for positive replies
4. Move CRM automatically based on detected intent and outcomes
5. Consolidate worker execution into one reliable orchestration path

## Concrete features I would propose for ANTONIA Autopilot

### 1. Autopilot control center

New panel in `ANTONIA` showing:

- current mode
- active missions
- tasks running now
- budget consumption
- pending approvals
- risk alerts
- hot leads requiring human action

### 2. Mission templates for outsourcing

Prebuilt objectives such as:

- HR outsourcing in retail
- staffing TI for mid-market
- payroll outsourcing for multi-site companies
- recruiting services for fast-growth startups
- seasonal staffing for operations teams

### 3. Smart contact policy

For every lead, ANTONIA should decide:

- contact now
- research more first
- wait for business hours
- exclude from campaign
- escalate to human

### 4. Positive reply autopilot

When reply intent is `meeting_request` or `positive`, ANTONIA should:

1. stop follow-ups
2. create CRM action
3. notify owner
4. propose reply draft
5. optionally send booking link

### 5. Deliverability watchdog

Automatic checks for:

- bounce spikes
- unsubscribe spikes
- blocked domains
- low open rate by sequence
- repeated provider failures

If triggered, ANTONIA should pause the affected playbook or channel automatically.

## Architecture callouts before scaling autopilot

- Keep one worker path. Today there is overlap between `src/app/api/cron/antonia/route.ts` and `functions/src/antonia-worker.ts`.
- Move hardcoded worker/search URLs to environment-driven routing.
- Extend task states beyond `pending/processing/completed/failed` with richer outcome semantics where needed.
- Make reply and tracking updates atomic to reduce race conditions.
- Add an explicit `autopilot_policy` object at org and mission level.

## Suggested 90-day roadmap

### Days 1-30

- Autopilot mode selector
- Guardrails and approvals
- Exception queue
- Lead scoring v1
- Better mission control dashboard

### Days 31-60

- Playbook engine for outsourcing
- Auto-tuning from mission intelligence
- Next-best-action engine
- CRM action automation
- Deliverability watchdog

### Days 61-90

- Calendar integration and meeting capture
- Pipeline outcome reporting
- Benchmarking by vertical
- Worker consolidation
- Enterprise autopilot controls

## Success metrics

I would measure the autopilot against:

- time from mission creation to first qualified reply
- meetings booked per week
- reply rate by playbook
- percentage of leads handled without manual touch
- exception rate per 100 contacted leads
- human time saved per SDR/AE
- proposal creation rate from positive replies

## Recommended next build step

If we start implementing now, the best first slice is:

1. define autopilot modes and policies
2. create the exception queue
3. add score-based contact decisions
4. wire positive replies into CRM next actions

That slice is the fastest path from "automation features" to a system users can actually leave running.
