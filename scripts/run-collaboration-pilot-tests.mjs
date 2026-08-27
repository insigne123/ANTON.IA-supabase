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
  throw new Error('Missing .env.test.nonprod.local. Run npm run test:env:nonprod.');
}

const testEnv = dotenv.parse(fs.readFileSync(envPath));
Object.assign(process.env, testEnv);
const target = assertSafeTestTarget();
if (target.kind !== 'nonprod' || target.projectRef !== NONPROD_PROJECT_REF) {
  throw new Error('Collaboration pilot tests only run against approved nonprod.');
}
if (testEnv.OUTBOUND_DELIVERY_MODE !== 'disabled' || testEnv.ALLOW_EXTERNAL_SIDE_EFFECTS !== 'false') {
  throw new Error('External side effects must remain disabled for collaboration pilot tests.');
}
await ensureQaIdentities();

const child = spawn(
  process.execPath,
  [
    '--loader',
    './scripts/ts-test-loader.mjs',
    '--test',
    path.join(ROOT, '__tests__', 'organization-contact-thread.integration.test.mjs'),
  ],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      RUN_SUPABASE_INTEGRATION: 'true',
      RUN_COLLABORATION_PILOT: 'true',
    },
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
