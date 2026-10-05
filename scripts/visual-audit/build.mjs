// The production build every audit runs against: compiled once into .next-audit, with the same public flags production
// uses, and reused while HEAD, the working tree (outside the audit, docs and tests) and the public variables are unchanged.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DIST_DIR, ROOT } from './env.mjs';

const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim();

export function buildFingerprint(env) {
  const diff = git('diff', 'HEAD', '--', '.', ':(exclude)scripts/visual-audit', ':(exclude)scripts/usability', ':(exclude)docs', ':(exclude)__tests__', ':(exclude)package.json');
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', 'src', 'public');
  // Public variables are inlined at build time, so a change in them needs a new build too.
  const inlined = JSON.stringify(Object.entries(env).filter(([name]) => name.startsWith('NEXT_PUBLIC_')).sort());
  return createHash('sha256').update(`${git('rev-parse', 'HEAD')}\n${diff}\n${untracked}\n${inlined}`).digest('hex');
}

function run(command, commandArgs, { env, logFile }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = createWriteStream(logFile);
    child.stdout.pipe(out); child.stderr.pipe(out);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} ${commandArgs.join(' ')} terminó con código ${code}. Revisa ${logFile}`))));
  });
}

/** Builds into DIST_DIR unless a build of this same code is there (or `skipBuild`, which needs one to exist). */
export async function ensureBuild({ env, logFile, skipBuild = false, log = () => {} }) {
  const fingerprintFile = path.join(ROOT, DIST_DIR, 'audit-fingerprint');
  const fingerprint = buildFingerprint(env);
  const reusable = existsSync(fingerprintFile) && readFileSync(fingerprintFile, 'utf8') === fingerprint;
  if (skipBuild && !existsSync(path.join(ROOT, DIST_DIR, 'BUILD_ID'))) throw new Error(`--skip-build sin compilación previa en ${DIST_DIR}.`);
  if (skipBuild || reusable) {
    log(`Reutilizo la compilación de ${DIST_DIR}.`);
    return;
  }
  log(`Compilando en ${DIST_DIR} (unos minutos)…`);
  // The build may fetch Google Fonts, so it keeps the machine's proxy settings; the audited server never gets them.
  const network = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(https?_proxy|no_proxy|HTTPS?_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/.test(name)));
  await run(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { env: { ...env, ...network }, logFile });
  writeFileSync(fingerprintFile, fingerprint);
}
