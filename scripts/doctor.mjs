import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { assertSafeTestTarget } from './assert-test-target.mjs';
import { NONPROD_PROJECT_REF, assertLinkedNonprod } from './supabase-nonprod.mjs';

const ROOT = process.cwd();
const failures = [];
const warnings = [];

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.warn(`WARN ${message}`);
}

function commandExists(command, args) {
  const isWindows = process.platform === 'win32';
  const result = spawnSync(
    isWindows ? (process.env.ComSpec || 'cmd.exe') : command,
    isWindows ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args,
    {
    cwd: ROOT,
    encoding: 'utf8',
    },
  );
  return result.status === 0 ? result.stdout.trim() : '';
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor === 22) pass(`Node ${process.versions.node}`);
else fail(`Node 22 is required; found ${process.versions.node}.`);

const supabaseVersion = commandExists('npx', ['--no-install', 'supabase', '--version']);
if (supabaseVersion) pass(`Supabase CLI ${supabaseVersion}`);
else fail('Local Supabase CLI is unavailable. Run npm install.');

const dockerVersion = commandExists('docker', ['version', '--format', '{{.Server.Version}}']);
if (dockerVersion) pass(`Docker daemon ${dockerVersion}`);
else fail('Docker Desktop is not running or cannot be reached.');

for (const relativePath of ['supabase/config.toml', 'supabase/seed.sql', '.env.test.example']) {
  if (fs.existsSync(path.join(ROOT, relativePath))) pass(`${relativePath} exists`);
  else fail(`${relativePath} is missing.`);
}

try {
  assertLinkedNonprod(ROOT);
  pass(`Supabase CLI linked to nonprod ${NONPROD_PROJECT_REF}`);
} catch (error) {
  warn(error.message);
}

const testEnvPath = path.join(ROOT, '.env.test.local');
if (!fs.existsSync(testEnvPath)) {
  warn('.env.test.local is missing. Start Supabase local, then run npm run test:env:local.');
} else {
  try {
    const testEnv = dotenv.parse(fs.readFileSync(testEnvPath));
    const target = assertSafeTestTarget({ ...process.env, ...testEnv });
    pass(`Test environment targets safe ${target.kind} Supabase (${target.hostname})`);
  } catch (error) {
    fail(`.env.test.local is unsafe: ${error.message}`);
  }
}

if (warnings.length > 0) {
  console.warn(`\n[doctor] ${warnings.length} warning(s).`);
}
if (failures.length > 0) {
  console.error(`\n[doctor] ${failures.length} required check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\n[doctor] Environment is ready.');
}
