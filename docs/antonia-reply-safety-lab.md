# ANTONIA Reply Safety Lab

## Goal

Validate autonomous reply behavior before enabling production auto-send for inbound email threads.

## What is included

- Policy engine for inbound replies: `src/lib/antonia-reply-policy.ts`
- Built-in replay suite: `src/lib/antonia-reply-lab.ts`
- Execution API and run history: `src/app/api/antonia/reply-lab/route.ts`
- Draft generation endpoint for replied leads: `src/app/api/antonia/replies/draft/route.ts`
- UI runner: `src/app/(app)/antonia/reply-lab/page.tsx`

## Modes

- `draft_only`: never auto-send, always prepare draft
- `shadow_mode`: simulates auto-send decisions but keeps draft only
- `auto_safe`: auto-send only safe positive and meeting-request replies
- `full_auto`: broadest autonomy, only after lab gates are stable

## Release gate

Recommended minimum before production:

- Pass rate >= 90%
- Zero failures on `unsubscribe`, `negative`, `delivery_failure`
- No failed pricing/security/legal/integration guardrail scenarios
- Shadow mode validated with real traffic before enabling `auto_safe`

## Suggested rollout

1. `draft_only`
2. `shadow_mode`
3. `auto_safe`
4. limited `full_auto`

## Notes

The safety lab validates policy behavior first. It does not replace provider sandbox tests, inbox watcher tests, or real-thread shadow mode validation.
