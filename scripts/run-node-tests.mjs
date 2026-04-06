import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

const ROOT = process.cwd();
const envPath = path.join(ROOT, '.env.local');

const loaded = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};

function collectTests(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.git')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(fullPath));
      continue;
    }

    if (/\.test\.(mjs|js|ts)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

const testFiles = collectTests(ROOT);

const child = spawn(
  process.execPath,
  ['--loader', './scripts/ts-test-loader.mjs', '--test', ...testFiles],
  {
    cwd: ROOT,
    env: { ...process.env, ...loaded },
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
