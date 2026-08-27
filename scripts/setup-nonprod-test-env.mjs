import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { assertSafeTestTarget } from './assert-test-target.mjs';
import { NONPROD_PROJECT_REF, assertLinkedNonprod } from './supabase-nonprod.mjs';

const ROOT = process.cwd();
const envPath = path.join(ROOT, '.env.test.nonprod.local');

assertLinkedNonprod(ROOT);

const cliArgs = [
  '--no-install',
  'supabase',
  'projects',
  'api-keys',
  '--project-ref',
  NONPROD_PROJECT_REF,
  '--reveal',
  '--output',
  'json',
];
const result = process.platform === 'win32'
  ? spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', ['npx', ...cliArgs].join(' ')],
    { cwd: ROOT, encoding: 'utf8' },
  )
  : spawnSync('npx', cliArgs, { cwd: ROOT, encoding: 'utf8' });

if (result.status !== 0) {
  console.error('[test:env:nonprod] Could not retrieve API keys for the approved nonprod project.');
  process.exit(1);
}

let keys;
try {
  keys = JSON.parse(result.stdout);
} catch {
  console.error('[test:env:nonprod] Supabase returned an invalid API key response.');
  process.exit(1);
}

const publishableKey = keys.find((key) => key.type === 'publishable' && key.name === 'default')?.api_key
  || keys.find((key) => key.name === 'anon')?.api_key;
const secretKey = keys.find((key) => key.type === 'secret' && key.name === 'default')?.api_key
  || keys.find((key) => key.name === 'service_role')?.api_key;
if (!publishableKey || !secretKey) {
  console.error('[test:env:nonprod] Required publishable and secret API keys are unavailable.');
  process.exit(1);
}

const previousEnv = fs.existsSync(envPath)
  ? dotenv.parse(fs.readFileSync(envPath))
  : {};
const qaTestPassword = String(previousEnv.QA_TEST_PASSWORD || '').trim()
  || randomBytes(24).toString('base64url');
const supabaseUrl = `https://${NONPROD_PROJECT_REF}.supabase.co`;
const testEnv = {
  APP_ENV: 'staging',
  TEST_DATABASE_ENABLED: 'true',
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: publishableKey,
  SUPABASE_SERVICE_ROLE_KEY: secretKey,
  QA_TEST_PASSWORD: qaTestPassword,
  SUPABASE_TEST_PROJECT_REF: NONPROD_PROJECT_REF,
  OUTBOUND_DELIVERY_MODE: 'disabled',
  ALLOW_EXTERNAL_SIDE_EFFECTS: 'false',
};

const target = assertSafeTestTarget(testEnv);
if (target.kind !== 'nonprod' || target.projectRef !== NONPROD_PROJECT_REF) {
  console.error('[test:env:nonprod] Refusing to write an environment for an unapproved project.');
  process.exit(1);
}

const content = `${Object.entries(testEnv)
  .map(([key, value]) => `${key}="${value.replaceAll('"', '\\"')}"`)
  .join('\n')}\n`;
fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
console.log('[test:env:nonprod] Wrote an approved nonprod-only environment file.');
