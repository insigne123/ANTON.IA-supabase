# Database

## Source of truth

The ordered SQL files in `supabase/migrations/` are the database schema source
of truth. `supabase/config.toml` enables migration replay and runs
`supabase/seed.sql` after a local reset. The seed is intentionally free of
production data; Auth identities are provisioned by scripts after reset.

Database work is local-first:

1. Author and review the migration locally.
2. Replay the complete history with a local reset.
3. Run lint, pgTAP, integration, and unit tests.
4. Review a dry run against the approved nonproduction project.
5. Push to nonproduction only with explicit approval.
6. Run the nonproduction smoke.

Production project `yfdelflsheurzaicwayi` is a forbidden write target for this
workflow. Its OpenCode MCP is configured read-only. There is intentionally no
`db:push:production` npm script, and no command in this document authorizes an
ad hoc production push.

## Targets and controls

| Target | Ref | Data | Database writes |
| --- | --- | --- | --- |
| Local | None | Disposable and synthetic | Allowed through local npm scripts. |
| Nonproduction | `htketmmhsfmucevvqmxi` | Synthetic only | Allowed only through guarded scripts after target verification and approval. |
| Production | `yfdelflsheurzaicwayi` | Real | Forbidden here; read-only diagnosis only. |

`scripts/supabase-nonprod.mjs` hard-codes the nonproduction ref and rejects
remote commands when the CLI link does not match it. Test scripts add a second
guard through `scripts/assert-test-target.mjs`.

## Existing commands

| Command | Behavior |
| --- | --- |
| `npm run db:start` | Starts the local Supabase containers. |
| `npm run db:stop` | Stops the local Supabase containers. |
| `npm run db:reset` | Destructively replays migrations and seed against local only. |
| `npm run test:reset` | Runs local reset, regenerates test environment, and restores QA identities. |
| `npm run db:lint` | Lints the local database at error level. |
| `npm run db:test` | Runs local pgTAP tests. |
| `npm run db:link:nonprod` | Links the CLI only to `htketmmhsfmucevvqmxi`. |
| `npm run db:status` | Lists linked migration status after asserting the nonproduction link. It is not a local container health check. |
| `npm run db:push:dry-run` | Previews pending migrations against linked nonproduction without applying them. |
| `npm run db:push:nonprod` | Applies pending migrations to guarded nonproduction. This is a remote write and requires explicit approval. |

Use `npm run doctor` for local prerequisite and target diagnostics.

## Authoring a migration

Use a new forward-only migration for every schema change. Do not edit a
migration already applied to a shared environment. Use a UTC timestamp and a
descriptive snake-case name, for example:

```text
supabase/migrations/20260826143000_add_example_constraint.sql
```

There is no package script for migration scaffolding. If a scaffold is useful,
use the repository-pinned CLI only:

```powershell
npx --no-install supabase migration new add_example_constraint
```

Review the generated filename and all SQL before running it. A migration should
be deterministic, preserve existing data deliberately, qualify schemas, and be
safe when replayed in repository order. Add or update pgTAP coverage under
`supabase/tests/` for constraints, RPC contracts, grants, and RLS behavior.

Do not copy schema or customer data from production to create a migration. Do
not use `supabase db pull` against production as a shortcut.

## Required local validation

Run the complete replay before considering a migration ready:

```powershell
npm run db:start
npm run test:reset
npm run db:lint
npm run db:test
npm run test:integration
npm run test:unit
```

Check the first migration error rather than patching the resulting local
database manually. Any manual local change disappears at the next reset and is
not part of the schema source of truth.

The current integration suite authenticates owner, member, and outsider users
with the anon key and verifies organization isolation. Expand those contracts
when a migration changes tenant ownership or RLS.

## Nonproduction migration workflow

Remote migration work must be explicitly requested. Authenticate the CLI with
an account that can access only the intended nonproduction project when
possible, then:

```powershell
npm run db:link:nonprod
npm run db:status
npm run db:push:dry-run
```

Review the dry-run output against the exact local migration files. Confirm that
the link is `htketmmhsfmucevvqmxi`, no unexpected migration is pending, and the
SQL contains no production identifiers or real data.

Only after explicit approval, apply to nonproduction and smoke it:

```powershell
npm run db:push:nonprod
npm run test:env:nonprod
npm run test:staging
```

For the collaboration V1 synthetic pilot, additionally run the guarded report
and explicit pilot suite. This suite writes durable `integration-noop` evidence:

```powershell
npm run collaboration:pilot:report
npm run test:collaboration:pilot
```

Never turn a failed dry run or smoke test into an automatic push. Resolve the
problem locally, replay the full history, and repeat review.

## Rollback and repair

Migrations are forward-only in shared environments. Do not delete migration
history, mark a failed migration as applied without evidence, or run destructive
repair commands against a hosted project.

- Before a nonproduction push, rollback means fixing the migration and
  repeating `npm run test:reset`.
- After a nonproduction push, create a reviewed corrective migration. Preserve
  data unless its deletion is explicitly part of the approved synthetic-data
  cleanup.
- For production, stop and use the separate release/incident process in
  [Deployment](./deployment.md). This documentation grants no production write
  permission.

Application rollback and database rollback are different. Reverting application
code does not remove an applied migration, so compatibility must be considered
before any shared-environment push.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Reset fails in the middle of history | Fix the first failing migration locally; do not patch later schema objects by hand. |
| Seed fails | Keep `supabase/seed.sql` deterministic and free of Auth passwords; identity setup belongs to `npm run test:identity:ensure`. |
| Lint reports an error | Resolve or explicitly document the database issue before dry-run review. Do not lower the lint level to hide it. |
| pgTAP reports a missing policy | Treat the expected policy set as a contract and review tenant behavior with all QA roles. |
| `db:status` rejects the link | Run `npm run db:link:nonprod` only if remote nonproduction work is authorized. Never link production. |
| Dry run shows unexpected migrations | Stop, compare local files with linked history, and resolve drift before any push. |
| Nonproduction smoke cannot find a table or RPC | Do not bypass the test. Verify migration status and repeat the local replay. |
| A URL or ref resolves to production | Stop immediately and report it; never override either guard. |

## Review checklist

- The migration is new, forward-only, ordered, and reviewed.
- `npm run test:reset`, `db:lint`, `db:test`, `test:integration`, and
  `test:unit` pass on Node 22.
- RLS behavior is checked as owner, member, and outsider where relevant.
- No production data, credentials, project URLs, or user identifiers were
  added.
- Nonproduction dry-run output contains only expected files.
- The nonproduction push, if any, had explicit approval and was followed by
  `npm run test:staging`.
- No production database write command was run.
