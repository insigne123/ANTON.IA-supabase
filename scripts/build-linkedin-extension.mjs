import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = resolve(root, 'chrome-extension');
const release = process.argv.includes('--release');
const output = release ? resolve(extension, 'dist') : extension;
await mkdir(output, { recursive: true });
await build({ entryPoints: [resolve(extension, 'ui/panel.tsx')], bundle: true, outfile: resolve(output, 'panel.js'),
  platform: 'browser', format: 'iife', target: 'chrome116', minify: true, legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' } });
if (release) {
  for (const file of ['panel.html', 'background.js', 'prospecting-background.js', 'content.js', 'prospecting-content.js', 'web_injector.js', 'prospecting-bridge.js', 'icon.png']) {
    await copyFile(resolve(extension, file), resolve(output, file));
  }
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.release.json'), 'utf8'));
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (process.platform === 'win32') {
    const downloads = resolve(root, 'public/downloads');
    await mkdir(downloads, { recursive: true });
    const zip = resolve(downloads, 'antonia-linkedin-extension.zip');
    const quote = value => `'${value.replace(/'/g, "''")}'`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path ${quote(resolve(output, '*'))} -DestinationPath ${quote(zip)} -Force`]);
    console.log(`Descarga pública actualizada: ${zip}`);
  }
}
console.log(`Extensión ${release ? 'de distribución' : 'de desarrollo'} compilada: ${output}`);
