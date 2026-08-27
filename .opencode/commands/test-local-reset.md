---
description: Rebuild local Supabase and restore the safe QA identities.
agent: build
---

Run the repository's local Supabase reset workflow from the project root.

Safety requirements:

- Operate only on local Supabase. Production `yfdelflsheurzaicwayi` and all
  hosted database targets are forbidden.
- Do not read or load `.env.local`.
- Do not use either Supabase MCP, invoke an ad hoc Supabase CLI command, push a
  migration, or modify source files.
- Execute only existing npm scripts for this workflow.

Execute these commands in order, stopping at the first failure:

1. `npm run db:start`
2. `npm run test:reset`
3. `npm run doctor`

Report each command's status and confirm that `.env.test.local` targets
`127.0.0.1` without printing any key or `QA_TEST_PASSWORD`.
