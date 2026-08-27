import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { assertSafeTestTarget } from './assert-test-target.mjs';
import { ensureQaIdentities } from './bootstrap-test-identities.mjs';
import { NONPROD_PROJECT_REF } from './supabase-nonprod.mjs';

const ROOT = process.cwd();
const envPath = path.join(ROOT, '.env.test.nonprod.local');
if (!fs.existsSync(envPath)) {
  console.error('[test:staging] Missing .env.test.nonprod.local. Run npm run test:env:nonprod.');
  process.exit(1);
}

const testEnv = dotenv.parse(fs.readFileSync(envPath));
Object.assign(process.env, testEnv);

try {
  const target = assertSafeTestTarget();
  if (target.kind !== 'nonprod' || target.projectRef !== NONPROD_PROJECT_REF) {
    throw new Error('test:staging only runs against the approved nonprod project.');
  }
  await ensureQaIdentities();
} catch (error) {
  console.error(`[test:staging] ${error.message}`);
  process.exit(1);
}

const testFiles = [
  path.join(ROOT, '__tests__', 'supabase-connectivity.integration.test.mjs'),
  path.join(ROOT, '__tests__', 'supabase-qa-identities.integration.test.mjs'),
];
const child = spawn(
  process.execPath,
  ['--loader', './scripts/ts-test-loader.mjs', '--test', ...testFiles],
  {
    cwd: ROOT,
    env: { ...process.env, RUN_SUPABASE_INTEGRATION: 'true' },
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
