import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { assertSafeTestTarget } from './assert-test-target.mjs';
import { ensureQaIdentities } from './bootstrap-test-identities.mjs';

const ROOT = process.cwd();
const envPath = path.join(ROOT, '.env.test.local');

if (!fs.existsSync(envPath)) {
  console.error('[test:integration] Missing .env.test.local. Start from .env.test.example.');
  process.exit(1);
}

const testEnv = dotenv.parse(fs.readFileSync(envPath));
Object.assign(process.env, testEnv);

try {
  const target = assertSafeTestTarget();
  if (target.kind !== 'local') {
    throw new Error('test:integration only runs against the local Supabase stack.');
  }
} catch (error) {
  console.error(`[test:integration] ${error.message}`);
  process.exit(1);
}

try {
  await ensureQaIdentities();
} catch (error) {
  console.error(`[test:integration] ${error.message}`);
  process.exit(1);
}

function collectTests(dir) {
  if (!fs.existsSync(dir)) return [];
  const tests = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      tests.push(...collectTests(fullPath));
    } else if (/\.integration\.test\.(mjs|js|ts)$/.test(entry.name)) {
      tests.push(fullPath);
    }
  }
  return tests;
}

const testFiles = [
  ...collectTests(path.join(ROOT, '__tests__')),
  ...collectTests(path.join(ROOT, 'src')),
].sort();

if (testFiles.length === 0) {
  console.error('[test:integration] No integration test files found.');
  process.exit(1);
}

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
