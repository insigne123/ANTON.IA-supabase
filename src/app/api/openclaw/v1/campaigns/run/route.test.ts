import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const routeSource = await readFile(new URL('./route.ts', import.meta.url), 'utf8');

test('OpenClaw campaign runs always scope the internal cron to the token organization', () => {
  assert.match(routeSource, /targetUrl\.searchParams\.set\('organizationId', claims\.orgId\)/);
  assert.doesNotMatch(routeSource, /body\.organizationId/);
});
