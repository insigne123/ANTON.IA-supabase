import { spawn } from 'node:child_process';

const ROOT = process.cwd();

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} was interrupted by ${signal}.`));
      else if (code !== 0) reject(new Error(`${command} exited with ${code}.`));
      else resolve();
    });
  });
}

function runSupabase(args) {
  if (process.platform === 'win32') {
    return run(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', ['npx', '--no-install', 'supabase', ...args].join(' ')],
    );
  }
  return run('npx', ['--no-install', 'supabase', ...args]);
}

async function main() {
  await runSupabase(['db', 'reset', '--local']);
  await run(process.execPath, ['scripts/setup-local-test-env.mjs']);
  await run(process.execPath, ['scripts/bootstrap-test-fixtures.mjs']);
  console.log('[test:reset] Local database, QA identities, and deterministic fixtures are ready.');
}

main().catch((error) => {
  console.error(`[test:reset] ${error.message}`);
  process.exitCode = 1;
});
