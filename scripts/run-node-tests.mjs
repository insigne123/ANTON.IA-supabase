import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();

const SAFE_UNIT_TEST_ENV = /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES(?:\(X86\))?|PROGRAMW6432|CI|GITHUB_ACTIONS|TERM|COLORTERM|NO_COLOR|FORCE_COLOR|TZ|LANG|LC_ALL)$/;

const unitTestEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => SAFE_UNIT_TEST_ENV.test(name.toUpperCase())),
);

Object.assign(unitTestEnv, {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  ALLOW_EXTERNAL_SIDE_EFFECTS: 'false',
  OUTBOUND_DELIVERY_MODE: 'disabled',
});

function collectTests(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.git')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(fullPath));
      continue;
    }

    if (/\.test\.(mjs|js|ts)$/.test(entry.name)
      && !/\.(integration|e2e)\.test\.(mjs|js|ts)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

const selectedTests = process.argv.slice(2);
if (selectedTests.some((file) => !/\.test\.(mjs|js|ts)$/.test(file) || /\.(integration|e2e)\.test\./.test(file) || path.relative(ROOT, path.resolve(file)).startsWith('..'))) {
  throw new Error('Only workspace unit test paths are accepted.');
}
const testFiles = selectedTests.length ? selectedTests.map((file) => path.resolve(file)) : [
  ...collectTests(path.join(ROOT, '__tests__')),
  ...collectTests(path.join(ROOT, 'src')),
].sort();

if (testFiles.length === 0) {
  console.error('[test:unit] No unit test files found.');
  process.exit(1);
}

// Windows CreateProcess caps the full command line. Bound each batch and preserve every selected file.
const batches = [];
let batch = [], chars = 0;
for (const file of testFiles) {
  if (process.platform === 'win32' && batch.length && (chars + file.length + 3 > 24000 || batch.length >= 32)) {
    batches.push(batch); batch = []; chars = 0;
  }
  batch.push(file); chars += file.length + 3;
}
if (batch.length) batches.push(batch);
let failed = false;
for (const [index, files] of batches.entries()) {
  if (batches.length > 1) console.log(`[test:unit] Batch ${index + 1}/${batches.length}: ${files.length} files`);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--loader', './scripts/ts-test-loader.mjs', '--test', ...(process.platform === 'win32' ? ['--test-concurrency=4'] : []), ...files], {
      cwd: ROOT, env: unitTestEnv, stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  if (result.signal) { process.kill(process.pid, result.signal); break; }
  if (result.code !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
