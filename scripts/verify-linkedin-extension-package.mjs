import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';

const root = new URL('../', import.meta.url);
const zipBytes = await readFile(new URL('public/downloads/antonia-linkedin-extension.zip', root));
const zip = new AdmZip(zipBytes);
const expected = ['background.js', 'content.js', 'prospecting-background.js', 'prospecting-content.js', 'prospecting-send.js', 'prospecting-bridge.js', 'panel.html', 'panel.js', 'panel.css', 'manifest.json', 'icon.png'].sort();
assert.deepEqual(zip.getEntries().map(entry => entry.entryName).sort(), expected, 'ZIP must contain only the release allowlist at its root');
const manifest = JSON.parse(zip.readAsText('manifest.json'));
assert.deepEqual(manifest, JSON.parse(await readFile(new URL('chrome-extension/manifest.release.json', root), 'utf8')));
assert.equal(JSON.stringify(manifest).includes('localhost'), false);
assert.equal(JSON.stringify(manifest).includes('web_injector'), false);
for (const name of expected.filter(name => name !== 'manifest.json')) {
  assert.ok(zip.readFile(name).equals(await readFile(new URL(`chrome-extension/${name}`, root))), `Outdated ZIP entry: ${name}`);
}
console.log(`PASS: ZIP ${manifest.version}, ${zipBytes.length} bytes, ${expected.length} verified files, no legacy bridge or development hosts.`);
console.log(`SHA-256: ${createHash('sha256').update(zipBytes).digest('hex')}`);
