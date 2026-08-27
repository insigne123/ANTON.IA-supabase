---
description: Run the complete safe local verification matrix.
agent: build
---

Run the local verification workflow without loading `.env.local` or contacting
hosted projects:

1. `npm run doctor`
2. `npm run test:reset`
3. `npm run db:lint`
4. `npm run db:test`
5. `npm run db:types`
6. `npm run test:integration`
7. `npm run test:unit`
8. `npm run typecheck`

Stop at the first failure and report it. Never invoke a provider, remote push,
nonprod smoke, or production command as part of this workflow.
