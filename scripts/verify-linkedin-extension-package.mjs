import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const root = new URL('../', import.meta.url);
const zipBytes = await readFile(new URL('public/downloads/antonia-linkedin-extension.zip', root));
const zip = await JSZip.loadAsync(zipBytes);
const expected = ['background.js', 'content.js', 'prospecting-background.js', 'prospecting-content.js', 'prospecting-send.js', 'prospecting-invite.js', 'prospecting-bridge.js', 'panel.html', 'panel.js', 'panel.css', 'manifest.json', 'icon.png'].sort();
assert.deepEqual(Object.keys(zip.files).sort(), expected, 'ZIP must contain only the release allowlist at its root');
const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
assert.deepEqual(manifest, JSON.parse(await readFile(new URL('chrome-extension/manifest.release.json', root), 'utf8')));
assert.equal(JSON.stringify(manifest).includes('localhost'), false);
assert.equal(JSON.stringify(manifest).includes('web_injector'), false);
const development = JSON.parse(await readFile(new URL('chrome-extension/manifest.json', root), 'utf8'));
assert.equal(manifest.version, development.version);
assert.deepEqual(manifest.permissions, development.permissions, 'release must not add permissions');
for (const name of expected.filter(name => name !== 'manifest.json')) {
  assert.ok((await zip.file(name).async('nodebuffer')).equals(await readFile(new URL(`chrome-extension/dist/${name}`, root))), `Outdated ZIP entry: ${name}`);
}
console.log(`PASS: ZIP ${manifest.version}, ${zipBytes.length} bytes, ${expected.length} verified files, no legacy bridge or development hosts.`);
console.log(`SHA-256: ${createHash('sha256').update(zipBytes).digest('hex')}`);
