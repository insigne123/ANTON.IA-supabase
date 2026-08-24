import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  LEGACY_RUNTIME_RETIRED,
} from '@/lib/server/legacy-runtime-retirement';
import { GET as n8nGet, POST as n8nPost } from '@/app/api/research/n8n/route';
import { GET as serpApiAccountGet } from '@/app/api/research/serpapi-account/route';

const appHosting = readFileSync('apphosting.yaml', 'utf8');
const envTemplate = readFileSync('.env.example', 'utf8');
const productionVerifier = readFileSync('scripts/verify-production-config.mjs', 'utf8');
const secretSync = readFileSync('scripts/apphosting-sync-secrets.sh', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const deploymentGuide = readFileSync('docs/deployment.md', 'utf8');
const n8nRoute = readFileSync('src/app/api/research/n8n/route.ts', 'utf8');
const serpApiRoute = readFileSync('src/app/api/research/serpapi-account/route.ts', 'utf8');

test('retired public runtimes return explicit no-store 410 responses', async () => {
  const responses = [
    ['n8n-research', await n8nGet()],
    ['n8n-research', await n8nPost()],
    ['serpapi-account', await serpApiAccountGet()],
  ] as const;

  for (const [runtime, response] of responses) {
    const body = await response.json();

    assert.equal(response.status, 410);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('deprecation'), 'true');
    assert.equal(response.headers.get('x-legacy-runtime'), runtime);
    assert.equal(body.error, LEGACY_RUNTIME_RETIRED);
    assert.equal(body.runtime, runtime);
  }
});

test('production configuration and current guides exclude retired runtimes', () => {
  assert.doesNotMatch(appHosting, /(?:VANE_|N8N_|GLM_|SERPAPI_)/);
  assert.doesNotMatch(envTemplate, /(?:VANE_|N8N_|GLM_|SERPAPI_|LEADS_N8N_|ANTONIA_N8N_|LEAD_RESEARCH_USE_N8N)/);
  assert.doesNotMatch(productionVerifier, /(?:GLM_API_KEY|N8N_RESEARCH_WEBHOOK_URL)/);
  assert.match(productionVerifier, /aiProvider !== 'openai'/);
  assert.doesNotMatch(secretSync, /VANE_AUTH_HEADER_VALUE/);
  assert.doesNotMatch(readme, /\bn8n\b/i);
  assert.doesNotMatch(deploymentGuide, /\bn8n\b/i);
  assert.match(n8nRoute, /retiredLegacyRuntimeResponse\('n8n-research'\)/);
  assert.match(serpApiRoute, /retiredLegacyRuntimeResponse\('serpapi-account'\)/);
});
