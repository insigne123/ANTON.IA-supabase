// Read-only HTTP checks. No session, provider calls, sends or database writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
const base = 'https://studio--leadflowai-3yjcy.us-central1.hosted.app';
const response = await fetch(`${base}/downloads/antonia-linkedin-extension.zip?verify=${Date.now()}`);
assert.equal(response.status, 200);
const bytes = Buffer.from(await response.arrayBuffer());
const local = await readFile(new URL('../public/downloads/antonia-linkedin-extension.zip', import.meta.url));
assert.ok(bytes.equals(local), 'Production ZIP must match local verified artifact');
const expectedVersion = JSON.parse(await readFile(new URL('../chrome-extension/manifest.release.json', import.meta.url), 'utf8')).version;
assert.equal(JSON.parse(new AdmZip(bytes).readAsText('manifest.json')).version, expectedVersion);
console.log(`PASS production ZIP ${expectedVersion}: ${bytes.length} bytes, SHA256 ${createHash('sha256').update(bytes).digest('hex')}`);
const privacy = await fetch(`${base}/privacy/extension`);
assert.equal(privacy.status, 200);
assert.match(await privacy.text(), /1200 caracteres/);
console.log('PASS updated public privacy policy');
const connect = await fetch(`${base}/extension/connect`, { redirect: 'manual' });
assert.ok([200, 302, 303, 307, 308].includes(connect.status));
console.log(`PASS connect entry: ${connect.status}, redirect=${connect.headers.get('location') || 'none'}`);
const api = await fetch(`${base}/api/extension/workspace`, { method: 'POST', headers: { origin: base, 'Content-Type': 'application/json', 'X-Antonia-Extension': '1' }, body: JSON.stringify({ action: 'session' }) });
assert.equal(api.status, 401);
console.log('PASS workspace API rejects unauthenticated session with 401');
for (const [origin, expected] of [
  [`chrome-extension://${'a'.repeat(32)}`, 401],
  ['https://www.linkedin.com', 403],
  [`chrome-extension://${'a'.repeat(32)}.evil.test`, 403],
]) {
  const result = await fetch(`${base}/api/extension/workspace`, {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json', 'X-Antonia-Extension': '1' },
    body: JSON.stringify({ action: 'session' }),
  });
  assert.equal(result.status, expected, `Unexpected workspace origin handling: ${origin}`);
}
console.log('PASS extension origin reaches authentication; LinkedIn and malformed origins remain blocked');
