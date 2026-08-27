---
description: Create a new local Supabase migration safely.
agent: build
---

Create a local migration named `$ARGUMENTS`.

Validate that the name is non-empty snake_case. Run `npm run doctor`, inspect
`git status --short`, then execute
`npx --no-install supabase migration new $ARGUMENTS`. Do not link, push, repair
remote history, or contact production. Report the new migration path and leave
its SQL empty unless the user also supplied an explicit schema change.
