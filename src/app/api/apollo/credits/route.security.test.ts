import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

test('Apollo shared credit route stays authenticated, derived, and private', () => {
  assert.match(source, /await requireAuth\(\)/);
  assert.match(source, /loadLatestApolloCreditBalance/);
  assert.match(source, /scope:\s*'shared'/);
  assert.match(source, /'Cache-Control': 'private, no-store, max-age=0'/);
  assert.match(source, /Vary: 'Cookie'/);
  assert.doesNotMatch(source, /APOLLO_API_KEY/);
  assert.doesNotMatch(source, /getSupabaseAdminClient/);
});
