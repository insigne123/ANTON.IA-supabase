---
description: Run the guarded Supabase smoke suite against the approved nonproduction project.
agent: build
---

Run the explicitly requested nonproduction smoke workflow from the project
root. This workflow may create or update only synthetic QA identities in
`htketmmhsfmucevvqmxi`.

Safety requirements:

- The only allowed hosted target is nonproduction `htketmmhsfmucevvqmxi`.
- Production `yfdelflsheurzaicwayi` is read-only and forbidden for every write
  or test operation.
- Do not read or load `.env.local`, use the production MCP, execute an ad hoc
  Supabase CLI command, or modify source files.
- Do not run `db:push:nonprod` or any migration push as part of a smoke test.
- Execute only existing npm scripts for this workflow.

Execute `npm run db:status` first. If and only if it reports that the CLI is
linked to no project or the wrong project, execute `npm run db:link:nonprod` and
then rerun `npm run db:status`. Stop if the reported ref is not exactly
`htketmmhsfmucevvqmxi`.

Then execute in order:

1. `npm run test:env:nonprod`
2. `npm run test:staging`

Report target verification and test results without printing
`.env.test.nonprod.local`, API keys, or `QA_TEST_PASSWORD`. If schema is missing,
report the migration gap and stop; never push automatically.
