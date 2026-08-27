# Testing

## Safety contract

Tests are local-first and fail closed before connecting to Supabase. The only
remote test target is nonproduction project `htketmmhsfmucevvqmxi`.
Production project `yfdelflsheurzaicwayi` is forbidden for all test and QA
writes and is available to OpenCode only for read-only diagnosis.

Never run a test suite with `.env.local`. Local and nonproduction test files set
the following controls:

- `TEST_DATABASE_ENABLED=true`
- `APP_ENV=test` for local or `APP_ENV=staging` for nonproduction
- `OUTBOUND_DELIVERY_MODE=mock` locally or `disabled` in nonproduction
- `ALLOW_EXTERNAL_SIDE_EFFECTS=false`
- `SUPABASE_TEST_PROJECT_REF=htketmmhsfmucevvqmxi` for the approved remote
  target

`scripts/assert-test-target.mjs` rejects production, an unexpected remote ref,
an invalid environment mode, or a missing database-test opt-in. Do not bypass
this guard.

## Test suites

| Command | Target | Purpose |
| --- | --- | --- |
| `npm test` | Node only | Alias for `test:unit`. |
| `npm run test:unit` | Node only | Unit tests; excludes `.integration` and `.e2e` files. |
| `npm run db:lint` | Local database | Reports database lint errors. |
| `npm run db:test` | Local database | Runs pgTAP contracts under `supabase/tests/`. |
| `npm run test:integration` | Local Supabase | Checks connectivity, real email/password auth, and tenant isolation. |
| `npm run test:staging` | Approved nonproduction | Runs the limited connectivity and QA-identity smoke suite. |
| `npm run test:collaboration:pilot` | Approved nonproduction | Runs the explicit collaboration concurrency/RLS pilot with a fake provider. |

Current local baseline: 112 pgTAP assertions, 4 integration tests, and 585 unit
tests.

There is currently no `test:e2e` package script. Do not describe ad hoc endpoint
scripts as part of the safe default suite. External email, Apollo, AI, webhook,
and cron effects are outside these database smoke tests.

## Local reset and full run

Start Docker Desktop, then run:

```powershell
npm run db:start
npm run test:reset
npm run db:lint
npm run db:test
npm run test:integration
npm run test:unit
```

`test:reset` performs a local database reset, regenerates `.env.test.local`, and
idempotently provisions QA identities and deterministic product fixtures. It
never resets a hosted database.

For a non-destructive repeat run against the current local data:

```powershell
npm run db:start
npm run test:env:local
npm run test:identity:ensure
npm run db:lint
npm run db:test
npm run test:integration
npm run test:unit
```

## QA identities

All stable QA users authenticate through Supabase email/password. There is no
login bypass.

| Email | Role and expected access |
| --- | --- |
| `qa-owner@antonia.test` | Owner of `ANTON.IA QA`; primary manual QA identity. |
| `qa-member@antonia.test` | Member of `ANTON.IA QA`; verifies shared tenant access. |
| `qa-outsider@antonia.test` | Owner of `ANTON.IA QA Externa`; verifies cross-tenant isolation. |

All three identities use the current `QA_TEST_PASSWORD` in the selected
generated test environment file. Never document, commit, log, or share that
password. `npm run test:identity:ensure` creates or updates users, verifies their
profiles, and idempotently restores the QA organizations, memberships, and
passwords.

`supabase/seed.sql` deliberately contains no production data. Stable identities
are created after reset because Supabase Auth users should be managed through
the bootstrap script, not embedded credentials in SQL.

For an isolated browser run, create and later remove an ephemeral local identity:

```powershell
npm run test:e2e:identity:create -- my-run-id
npm run test:e2e:identity:cleanup -- my-run-id
```

Run IDs use 4-48 lowercase letters, digits, or hyphens. Creation does not print
the password; use the current local `QA_TEST_PASSWORD`. Cleanup refuses users or
organizations it cannot prove belong to the requested run.

## Manual QA flow

1. Start Docker Desktop.
2. Run `npm run db:start` and `npm run test:reset`.
3. Load `.env.test.local` into a fresh shell as described in
   [Development](./development.md#running-the-app-against-local-supabase), then
   run `npm run dev`.
4. Open `http://localhost:9003/login` and sign in as
   `qa-owner@antonia.test` with the current local QA password.
5. Confirm the app redirects to `/dashboard` and the authenticated workspace
   loads without an authorization error.
6. Open `/settings/organization` and confirm the organization is `ANTON.IA QA`
   and both owner and member are represented as expected.
7. Sign out, sign in as `qa-member@antonia.test`, and verify the shared
   organization remains visible while owner-only actions are not granted to
   the member.
8. Sign out, sign in as `qa-outsider@antonia.test`, and verify only
   `ANTON.IA QA Externa` is visible. No `ANTON.IA QA` data should appear.
9. Exercise the feature under test using synthetic records only. Do not connect
   real inboxes, invoke external providers, enable cron, or send real messages.
10. Record the failing identity, route, expected result, actual result, console
    error, and relevant local service log. Do not include environment keys or
    passwords in the report.

Use separate browser profiles or sign out fully between identities to avoid a
cached Supabase session affecting an isolation check.

## Nonproduction smoke

The nonproduction smoke is opt-in because it creates or updates the three
synthetic QA identities. It does not send messages or push migrations.

Prerequisites are Supabase CLI authentication, access to
`htketmmhsfmucevvqmxi`, and an explicit request to use nonproduction. Then run:

```powershell
npm run db:link:nonprod
npm run db:status
npm run test:env:nonprod
npm run test:staging
```

`test:env:nonprod` retrieves the approved project's API keys and writes them to
the ignored `.env.test.nonprod.local`. Do not print or inspect that file in logs.
`test:staging` validates the target again, ensures QA identities, and runs only
the connectivity and tenant-isolation integration tests.

The collaboration pilot is separate because outbound dispatch history is
intentionally immutable. It writes synthetic `example.test` evidence using the
`integration-noop` provider and never invokes Gmail or Outlook:

```powershell
npm run collaboration:pilot:report
npm run test:collaboration:pilot
```

Run it only when durable synthetic evidence is desired. The target guard requires
`htketmmhsfmucevvqmxi`, `OUTBOUND_DELIVERY_MODE=disabled`, and
`ALLOW_EXTERNAL_SIDE_EFFECTS=false`.

If the smoke fails because migrations are absent, stop and report the missing
schema. Do not automatically run `npm run db:push:nonprod`; migration deployment
requires the review flow in [Database](./database.md).

## Troubleshooting

| Failure | Resolution |
| --- | --- |
| Local stack status cannot be read | Run `npm run db:start`, then `npm run test:env:local`. |
| Integration test says the environment is missing | Generate `.env.test.local`; do not substitute `.env.local`. |
| QA credentials are rejected | Rerun the matching identity bootstrap: `npm run test:identity:ensure` locally or `npm run test:identity:ensure:nonprod` for approved nonproduction. |
| Tenant-isolation assertion fails | Treat it as an RLS regression. Capture the identity and query, then inspect policies locally before any remote change. |
| pgTAP cannot find schema objects | Run `npm run test:reset` and inspect the first failing migration. |
| Nonproduction key retrieval fails | Confirm CLI login, project access, and `npm run db:status`; never replace the target with production. |
| Side-effect variables are enabled | Stop the run, regenerate the test environment, and verify external delivery remains mocked or disabled. |

To reproduce a defect, include the Node version, command, target (`local` or
`nonprod`, never credentials), migration filename if relevant, identity used,
and the first complete error. A clean local replay is the baseline:
`npm run test:reset` followed by the smallest affected suite.
