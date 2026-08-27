# Development

## Local-first rule

Daily development starts with the local Supabase stack. Local data is
disposable, migrations are replayed from the repository, and outbound effects
remain mocked. Do not use a hosted project when the same work can be completed
locally.

| Target | Project ref | Allowed use |
| --- | --- | --- |
| Supabase local | None | Development, resets, database tests, integration tests, and manual QA. |
| Nonproduction | `htketmmhsfmucevvqmxi` | Synthetic QA identities and an explicitly requested smoke test. |
| Production | `yfdelflsheurzaicwayi` | Read-only diagnosis through the configured read-only MCP. Never use it for development or tests. |

Production is a forbidden write target. Never link the development CLI to it,
run tests against it, create QA data in it, or use an ad hoc `supabase db push`
against it. The test target guard rejects its project ref.

## Prerequisites

- Node.js 22. Both `.nvmrc` and `package.json` require this major version.
- npm with dependencies installed using `npm ci`.
- Docker Desktop running before a local Supabase command. On Windows, use the
  Docker Linux container backend.
- The repository-local Supabase CLI. It is installed by `npm ci`; use the npm
  scripts rather than a separately installed global CLI.
- Supabase CLI authentication and access to `htketmmhsfmucevvqmxi` only when a
  nonproduction workflow is explicitly required. Local work needs no Supabase
  account.

Run the preflight after installing dependencies and starting Docker Desktop:

```powershell
npm run doctor
```

`doctor` checks Node 22, the local CLI, the Docker daemon, required Supabase
files, the local test target, and the optional nonproduction CLI link. A missing
nonproduction link is only a warning for local work.

## First local setup

```powershell
npm ci
npm run db:start
npm run test:reset
npm run doctor
```

`test:reset` is destructive only to the local database. It replays every file
in `supabase/migrations/`, applies `supabase/seed.sql`, regenerates
`.env.test.local`, and provisions the stable QA identities.

The local services configured in `supabase/config.toml` include:

| Service | URL or port |
| --- | --- |
| Supabase API | `http://127.0.0.1:54321` |
| PostgreSQL | `127.0.0.1:54322` |
| Supabase Studio | `http://127.0.0.1:54323` |
| Local email viewer | `http://127.0.0.1:54324` |
| Application | `http://localhost:9003` |

Local auth emails are captured by the local email viewer and are not delivered
to the internet.

## Environment files

| File | Purpose | Handling |
| --- | --- | --- |
| `.env.example` | General application template. Its Supabase URL identifies production as deployment context. | Never use it as a test target. Do not put real secrets in it. |
| `.env.local` | Developer application configuration. It may contain production values. | Never load it from tests or copy values from it into a test environment. |
| `.env.test.example` | Test environment contract with placeholders and side effects disabled. | Reference only; do not add real keys. |
| `.env.test.local` | Generated local Supabase URL, keys, and QA password. | Create with `npm run test:env:local`; keep ignored and local. |
| `.env.test.nonprod.local` | Generated credentials for the approved nonproduction project. | Create only with `npm run test:env:nonprod`; keep ignored and never share its contents. |

The generated test files set `TEST_DATABASE_ENABLED=true`, disable external
side effects, and are checked by `scripts/assert-test-target.mjs`. The service
role key is server-only and must never be logged, pasted into an issue, exposed
to browser code, or committed.

## Daily workflow

Start or restore the local environment:

```powershell
npm run db:start
npm run test:env:local
npm run test:identity:ensure
```

Use `npm run test:reset` instead when schema or seed state must be rebuilt from
scratch. Stop the containers when they are no longer needed:

```powershell
npm run db:stop
```

See [Testing](./testing.md) for suites and manual QA. See
[Database](./database.md) before changing a migration.

## Running the app against local Supabase

Next.js normally reads `.env.local`, so a plain `npm run dev` can target the
wrong Supabase project. For local manual QA, first load the generated test
variables into a fresh PowerShell process and then execute the existing dev
script:

```powershell
Get-Content -LiteralPath ".env.test.local" | ForEach-Object {
  if ($_ -match '^([A-Z][A-Z0-9_]*)="(.*)"$') {
    Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
  }
}
npm run dev
```

Process environment variables take precedence over `.env.local`. Confirm the
loaded `NEXT_PUBLIC_SUPABASE_URL` is `http://127.0.0.1:54321` before signing in.
Do not copy `.env.test.local` over `.env.local`.

## OpenCode workflows

Project commands are stored in `.opencode/commands/`:

- `/test-local-reset` rebuilds local Supabase and restores QA identities.
- `/test-local-run` runs the safe local validation suites without resetting
  first.
- `/smoke-nonprod` runs the guarded smoke suite against
  `htketmmhsfmucevvqmxi` without pushing migrations.

Restart OpenCode after adding or changing project command files; command
definitions are loaded at startup. The production MCP remains read-only, and
none of these commands permit production writes.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `Node 22 is required` | Switch to the version in `.nvmrc`, reinstall dependencies if necessary, and rerun `npm run doctor`. |
| Docker cannot be reached | Start Docker Desktop and wait for the daemon to become healthy before `npm run db:start`. |
| A local port is already in use | Stop the conflicting process or an old Supabase stack, then retry `npm run db:start`. Do not silently change committed ports. |
| `.env.test.local` is missing or stale | Start Supabase, then run `npm run test:env:local`. This refreshes local URLs and keys. |
| QA sign-in fails after a reset | Run `npm run test:identity:ensure`; use the current `QA_TEST_PASSWORD` from `.env.test.local`. |
| The CLI is linked to the wrong hosted project | Do not run a push. Use `npm run db:link:nonprod` only when nonproduction work was explicitly requested. |
| A command reports the production ref | Stop immediately. Do not override the guard or edit an environment file to bypass it. |

Production deployment remains a separate release process. Consult
[Deployment](./deployment.md) for deployment checks; this development workflow
does not authorize a production database change.
