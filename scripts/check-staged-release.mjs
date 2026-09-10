// Read-only release inventory. Examines the Git index, never .env files or credentials.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const files = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').toString().split('\0').filter(Boolean);
const findings = [];
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk-proj-|sk-ant-)[A-Za-z0-9_-]{32,}/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
];
function inspect(name, bytes) {
  if (/(^|\/)\.env(?:\.|$)|\.pem$|service.account.*\.json$|firebase-debug|(^|\/)node_modules\//i.test(name)) findings.push({ file: name, issue: 'private/generated file' });
  if (!/\.(?:[cm]?js|tsx?|json|html|css|md|sql|py|ya?ml)$/.test(name)) return;
  const text = bytes.toString('utf8');
  if (secretPatterns.some((pattern) => pattern.test(text))) findings.push({ file: name, issue: 'credential pattern (value withheld)' });
  if (/^(?:<<<<<<< |=======\r?$|>>>>>>> )/m.test(text)) findings.push({ file: name, issue: 'merge conflict marker' });
}
function inspectZip(name, bytes) {
  // Walk central directory so data-descriptor ZIPs are handled correctly too.
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Missing ZIP directory');
  const count = bytes.readUInt16LE(end + 10);
  let position = bytes.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(position) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const method = bytes.readUInt16LE(position + 10);
    const length = bytes.readUInt32LE(position + 20);
    const expanded = bytes.readUInt32LE(position + 24);
    const nameLength = bytes.readUInt16LE(position + 28);
    const entry = bytes.subarray(position + 46, position + 46 + nameLength).toString();
    const local = bytes.readUInt32LE(position + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const compressed = bytes.subarray(start, start + length);
    if (expanded > 10_000_000 || ![0, 8].includes(method)) throw new Error('Unsupported archive payload');
    const content = method === 8 ? inflateRawSync(compressed, { maxOutputLength: 10_000_000 }) : compressed;
    inspect(`${name}/${entry}`, content);
    entries.push(entry);
    position += 46 + nameLength + bytes.readUInt16LE(position + 30) + bytes.readUInt16LE(position + 32);
  }
  return entries;
}
for (const file of files) {
  const bytes = git('show', `:${file}`);
  inspect(file, bytes);
  const entries = file.endsWith('.zip') ? inspectZip(file, bytes) : undefined;
  console.log(JSON.stringify({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...(entries ? { entries } : {}) }));
}
console.log(JSON.stringify({ inspected: files.length, findings }));
if (findings.length) process.exitCode = 1;
