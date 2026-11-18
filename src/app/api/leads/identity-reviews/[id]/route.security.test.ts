import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

test('an identity review is read and decided in the workspace the person has open, never without one (18 nov)', () => {
  // The session alone carries no organization (requireSessionRequestAuth answers organizationId: null): every review was asked for
  // under the organization «null» and nobody could read theirs.
  assert.match(source, /await requireHomeAuth\(req\)/);
  assert.doesNotMatch(source, /requireSessionRequestAuth/);
  assert.doesNotMatch(source, /organizationId as string/);
  assert.match(source, /organizationId: who\.organizationId, userId: who\.userId/);
  assert.match(source, /'Cache-Control': 'no-store'/);
});
