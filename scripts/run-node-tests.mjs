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

const testFiles = [
  ...collectTests(path.join(ROOT, '__tests__')),
  ...collectTests(path.join(ROOT, 'src')),
].sort();

if (testFiles.length === 0) {
  console.error('[test:unit] No unit test files found.');
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ['--loader', './scripts/ts-test-loader.mjs', '--test', ...testFiles],
  {
    cwd: ROOT,
    // Provider credentials and remote targets are deliberately not inherited.
    env: unitTestEnv,
    stdio: 'inherit',
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
