import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

test('lead-search BFF supplies the backend secret only from server runtime configuration', () => {
  assert.match(source, /process\.env\.ENRICHMENT_SERVICE_SECRET/);
  assert.match(source, /"x-api-secret-key": backendSecret/);
  assert.match(source, /BACKEND_AUTH_NOT_CONFIGURED/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_ENRICHMENT_SERVICE_SECRET/);
});
