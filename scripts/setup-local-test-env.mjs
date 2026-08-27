import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { assertSafeTestTarget } from './assert-test-target.mjs';

const ROOT = process.cwd();
const envPath = path.join(ROOT, '.env.test.local');
const statusArgs = ['--no-install', 'supabase', 'status', '--output', 'env'];
const status = process.platform === 'win32'
  ? spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', ['npx', ...statusArgs].join(' ')],
    { cwd: ROOT, encoding: 'utf8' },
  )
  : spawnSync('npx', statusArgs, { cwd: ROOT, encoding: 'utf8' });

if (status.status !== 0) {
  console.error('[test:env:local] Could not read the local Supabase stack status. Start it with npm run db:start.');
  process.exit(1);
}

const values = {};
for (const line of status.stdout.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) continue;
  const [, key, rawValue] = match;
  values[key] = rawValue.replace(/^"|"$/g, '');
}

const apiUrl = values.API_URL;
const anonKey = values.ANON_KEY;
const serviceRoleKey = values.SERVICE_ROLE_KEY;
if (!apiUrl || !anonKey || !serviceRoleKey) {
  console.error('[test:env:local] Local Supabase status did not provide API_URL, ANON_KEY, and SERVICE_ROLE_KEY.');
  process.exit(1);
}

const previousEnv = fs.existsSync(envPath)
  ? dotenv.parse(fs.readFileSync(envPath))
  : {};
const qaTestPassword = String(previousEnv.QA_TEST_PASSWORD || '').trim()
  || randomBytes(24).toString('base64url');

const testEnv = {
  APP_ENV: 'test',
  TEST_DATABASE_ENABLED: 'true',
  NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  SUPABASE_URL: apiUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  QA_TEST_PASSWORD: qaTestPassword,
  SUPABASE_TEST_PROJECT_REF: 'htketmmhsfmucevvqmxi',
  OUTBOUND_DELIVERY_MODE: 'mock',
  ALLOW_EXTERNAL_SIDE_EFFECTS: 'false',
};

try {
  const target = assertSafeTestTarget(testEnv);
  if (target.kind !== 'local') throw new Error('The Supabase status endpoint is not local.');
} catch (error) {
  console.error(`[test:env:local] ${error.message}`);
  process.exit(1);
}

const content = `${Object.entries(testEnv)
  .map(([key, value]) => `${key}="${value.replaceAll('"', '\\"')}"`)
  .join('\n')}\n`;

fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
console.log('[test:env:local] Wrote a local-only .env.test.local.');
