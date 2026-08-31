import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/api/cron/fullenrich-enrichment-reconciliation/route.ts', 'utf8');

test('FullEnrich reconciliation makes a missing provider key visible to Firebase Scheduler', () => {
  assert.match(source, /summary\.skipped === 'api_key_not_configured'/);
  assert.match(source, /FullEnrich API key is not configured\./);
  assert.match(source, /status: 503/);
  assert.match(source, /firebaseSchedulerResponseHeaders\(\)/);
});
