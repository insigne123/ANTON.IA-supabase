# Migration History Reconciliation

## Status

2026-09-09 local history reconciliation on `main`. Production target:
`yfdelflsheurzaicwayi`. Only the public-company migration was renamed; its local
SQL contents were preserved. No SQL apply, history repair, production write or
deployment was performed. Concurrent EmailStudio/drafts migrations are
out of scope, including any unapplied SQL under active development.

The parent subsequently confirmed read-only MCP `version`, `name`, `statements`
results for public company and Report V2 foundation. Public-company production and
local SQL both have MD5 `6ed105ddbdd9fbbb3dc566fadd67f6e1` after removing all
whitespace (local method: `sql.replace(/\s/g, '')`). The parent also reviewed the
full production SQL and confirmed identical literals/comments, with indentation
differences only. The normalized hash alone is not byte-for-byte proof.
Local SQL is 106 lines, 6,461 bytes; raw SHA-256 before the rename:
`e41141ed084bacdb72531b0d33361a5fab042da3b248fd5cd6445def464f2c22`.

The parent confirmed foundation production version `20260908173355` and production
normalized MD5 `33b8edc9f16e06b5ada97fe4ec35c3f2`. Its timestamp already matches
the local file, so no foundation rename is needed. No local foundation SQL equality
claim is made here. EmailStudio/drafts SQL comparison remains pending; PostgREST
availability and catalog/RLS hashes do not establish migration SQL identity.

## Recorded Mapping

All local files are under `supabase/migrations/`.

| Migration | Local version | Recorded production version | Evidence and disposition |
| --- | --- | --- | --- |
| public_company_research | `20260909034401` | `20260909034401` | Renamed from historical local version `20260908190000` after the parent-confirmed SQL comparison above; local SQL unchanged. |
| report_v2_foundation | `20260908173355` | `20260908173355` | Parent-confirmed production version; timestamp already aligned, no rename. |
| email_template_library | `20260909120000` | `20260909131929` | Outreach post-apply record; concurrent EmailStudio ownership, no file changes or rename. |
| atomic_native_draft_revision | `20260909160000` | `20260909132044` | Outreach post-apply record; concurrent drafts ownership, no file changes or rename. |

## Pending Procedure

The remaining reconciliation concerns EmailStudio/drafts, not the aligned research
timestamps. Do not touch those actively owned migrations without coordination.

1. Coordinate with the EmailStudio/drafts owner before touching either owned
   migration or its tests. Capture the intended applied revision separately from
   any later development; never rename modified or unapplied SQL as already applied.
2. With read-only `supabase-production` access, confirm the project ref and fetch
   only the relevant migration history rows using the query below. If the MCP
   requires authentication, use `opencode mcp auth supabase-production`; do not
   print or commit credentials. Authentication alone does not expose a missing tool.
3. Retain the returned versions, names and ordered statements in a private local
   receipt. Compare each full local SQL file with the exact stored statement text
   and order. Record comparison method and SHA-256 digests of both compared inputs.
   Do not discard comments, normalize SQL, or use schema equivalence as proof.
   If statement splitting prevents an exact comparison, leave the rename pending
   until the original applied payload can be established unambiguously.
4. Only after proven equality and ownership clearance, use `apply_patch` to move
   one local file to the exact recorded production version without changing SQL.
   If equality fails, preserve both artifacts and report the difference; do not
   edit the historical migration or run `migration repair`, `db push` or SQL replay.
5. Update filename references in the same local change, coordinate any concurrently
   owned test edits, and run the affected local tests with Node 22 and sanitized
   test configuration, never against production or with `.env.local`. Review the
   scoped diff and `git diff --check`. Recheck only the relevant remote history
   before declaring alignment; do not use a bulk push to test reconciliation.

Pending read-only SQL, **not executed by this pass**:

```sql
SELECT version, name, statements
FROM supabase_migrations.schema_migrations
WHERE name IN (
  'public_company_research',
  'report_v2_foundation',
  'email_template_library',
  'atomic_native_draft_revision'
)
OR version IN (
  '20260908190000', '20260909034401', '20260908173355',
  '20260909120000', '20260909131929',
  '20260909160000', '20260909132044'
)
ORDER BY version;
```

## Reference Impact

Filename consumers and disposition:

- Public company: `scripts/public-company-sql.test.mjs` and
  `docs/shared-public-company-research.md` now use `20260909034401`.
- Report V2 foundation: `scripts/native-draft-sql.test.mjs`,
  `src/lib/server/research-report-synthesis-state.test.ts`,
  `src/lib/server/research-report-documents.test.ts` and
  `docs/report-v2-luna-terra-validation.md`. No edits needed; timestamp already aligned.
- Email library: `src/lib/email-studio/library-migration.test.ts` and the outreach
  deployment document. Preserve the explicitly historical filename in Constanza's
  early blocker record, with a mapping link rather than rewriting history.
- Atomic draft revision: `scripts/native-draft-sql.test.mjs` and the outreach
  deployment document.

Repeat the scoped filename search when coordinating eventual EmailStudio/drafts
renames because the shared worktree is active. Their consumers and tests are untouched.
