import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sources = [
  readFileSync('src/lib/campaigns-storage.ts', 'utf8'),
  readFileSync('src/lib/services/campaigns-service.ts', 'utf8'),
];

test('legacy campaign stores can only read and mutate outreach version 1', () => {
  for (const source of sources) {
    assert.ok((source.match(/\.eq\('outreach_version', 1\)/g) || []).length >= 3);
    assert.match(source, /outreach_version: 1/);
  }
});

test('the active legacy campaign service scopes mutations to the current organization', () => {
  const source = sources[1];
  assert.ok((source.match(/organization_id\.eq\.\$\{orgId\},organization_id\.is\.null/g) || []).length >= 2);
});
