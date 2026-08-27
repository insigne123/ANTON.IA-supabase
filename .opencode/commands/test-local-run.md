---
description: Run the complete safe test suite against the current local Supabase data.
agent: build
---

Run the repository's local validation workflow from the project root without
resetting the database first.

Safety requirements:

- Operate only on local Supabase. Production `yfdelflsheurzaicwayi` and all
  hosted database targets are forbidden.
- Do not read or load `.env.local`.
- Do not use either Supabase MCP, invoke an ad hoc Supabase CLI command, push a
  migration, or modify source files.
- Execute only existing npm scripts for this workflow.

Execute these commands in order, stopping at the first failure:

1. `npm run db:start`
2. `npm run test:env:local`
3. `npm run doctor`
4. `npm run test:identity:ensure`
5. `npm run db:lint`
6. `npm run db:test`
7. `npm run test:integration`
8. `npm run test:unit`

Report the first actionable failure or confirm all suites passed. Never print
environment keys or `QA_TEST_PASSWORD`.
