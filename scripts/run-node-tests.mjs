import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

const ROOT = process.cwd();
const envPath = path.join(ROOT, '.env.local');

const loaded = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};

const child = spawn(
  process.execPath,
  ['--loader', './scripts/ts-test-loader.mjs', '--test'],
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
