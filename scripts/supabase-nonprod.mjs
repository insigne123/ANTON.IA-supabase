import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const NONPROD_PROJECT_REF = 'htketmmhsfmucevvqmxi';

export function assertLinkedNonprod(root = process.cwd()) {
  const refPath = path.join(root, 'supabase', '.temp', 'project-ref');
  const linkedRef = fs.existsSync(refPath)
    ? fs.readFileSync(refPath, 'utf8').trim()
    : '';

  if (linkedRef !== NONPROD_PROJECT_REF) {
    throw new Error(
      `Supabase CLI is linked to ${linkedRef || 'no project'}, not the approved nonprod project.`,
    );
  }

  return linkedRef;
}

async function main() {
  const requestedArgs = process.argv.slice(2);
  if (requestedArgs.length === 0) {
    throw new Error('Pass a Supabase CLI command, for example: migration list --linked');
  }
  const isLinkCommand = requestedArgs.length === 1 && requestedArgs[0] === 'link';
  if (!isLinkCommand) assertLinkedNonprod();

  const args = isLinkCommand
    ? ['link', '--project-ref', NONPROD_PROJECT_REF]
    : requestedArgs;
  if (!args.every((arg) => /^(--)?[a-z0-9-]+$/.test(arg))) {
    throw new Error('Only fixed Supabase CLI command tokens are supported by this wrapper.');
  }

  const child = process.platform === 'win32'
    ? spawn(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', ['npx', '--no-install', 'supabase', ...args].join(' ')],
      { cwd: process.cwd(), stdio: 'inherit' },
    )
    : spawn('npx', ['--no-install', 'supabase', ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

  child.on('error', (error) => {
    console.error(`[supabase-nonprod] ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(`[supabase-nonprod] ${error.message}`);
    process.exitCode = 1;
  });
}
