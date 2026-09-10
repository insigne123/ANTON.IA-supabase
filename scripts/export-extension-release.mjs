// Produce a bounded source artifact from canonical main plus extension-only files.
// No stash, checkout, commit or modification of concurrent work is performed.
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('branch', '--show-current') !== 'main') throw new Error('Run from canonical main.');
const commit = git('rev-parse', 'HEAD');
const stamp = new Date().toISOString().replace(/[^0-9]/g, '');
const output = resolve(root, `.release-extension-${stamp}`);
await mkdir(output);
const archive = resolve(output, 'main.tar');
execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, commit], { cwd: root });
execFileSync('tar', ['-xf', archive, '-C', output], { cwd: root });
const files = [
  'package.json', 'package-lock.json', 'next.config.js',
  'src/lib/extension-contracts.ts', 'src/lib/extension-contracts.test.ts', 'src/lib/extension-profile-url.ts',
  'src/lib/server/extension-leads.ts', 'src/lib/server/extension-leads.test.ts',
  'src/lib/server/extension-campaigns.ts', 'src/lib/server/extension-campaigns.test.ts',
  'src/app/api/extension/workspace/route.ts', 'src/app/api/extension/workspace/route.test.ts',
  'src/app/(app)/extension/connect/page.tsx',
  'scripts/build-linkedin-extension.mjs', 'scripts/test-linkedin-extension-browser.mjs',
];
for (const file of files) {
  await mkdir(dirname(resolve(output, file)), { recursive: true });
  await copyFile(resolve(root, file), resolve(output, file));
}
// Only the explicitly built distributable is necessary on the release server.
await cp(resolve(root, 'chrome-extension/dist'), resolve(output, 'chrome-extension'), { recursive: true });
await cp(resolve(root, 'chrome-extension/ui'), resolve(output, 'chrome-extension/ui'), { recursive: true });
await cp(resolve(root, 'chrome-extension/tests'), resolve(output, 'chrome-extension/tests'), { recursive: true });
await mkdir(resolve(output, 'public/downloads'), { recursive: true });
await copyFile(resolve(root, 'chrome-extension/antonia-linkedin-workspace-4.0.1.zip'), resolve(output, 'public/downloads/antonia-linkedin-extension.zip'));
const ignorePath = resolve(output, '.gitignore');
await writeFile(ignorePath, (await readFile(ignorePath, 'utf8')).replace('/public/downloads/antonia-linkedin-extension.zip', '!/public/downloads/antonia-linkedin-extension.zip'));
const configPath = resolve(output, 'firebase.json');
const lintPath = resolve(output, '.eslintrc.json');
const lint = JSON.parse(await readFile(lintPath, 'utf8'));
await writeFile(lintPath, JSON.stringify({ ...lint, root: true }, null, 2) + '\n');
const config = JSON.parse(await readFile(configPath, 'utf8'));
config.apphosting.ignore.push('main.tar', 'extension-release-provenance.json', 'node_modules', '*.tsbuildinfo');
await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
await writeFile(resolve(output, 'extension-release-provenance.json'), JSON.stringify({ sourceBranch: 'main', baseCommit: commit, overlay: files, createdAt: new Date().toISOString() }, null, 2));
console.log(output);
