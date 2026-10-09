// Trusted launcher inside the isolated image. Capture the bounded tmpfs before the container stops.
import { spawn } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
// Independent of the HTTP/supervisor process: PID 1 exits and Docker stops the entire process namespace.
const watchdog = setTimeout(() => process.exit(124), Math.max(1000, Math.min(120000, Number(process.env.COWORK_JOB_TIMEOUT_MS) || 120000)));
const child = spawn('node', ['/work/main.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
const capture = stream => {
  let bytes = 0; const chunks = []; let truncated = false;
  stream.on('data', chunk => { const left = 65536 - bytes; if (chunk.length > left) truncated = true;
    if (left > 0) { chunks.push(chunk.subarray(0, left)); bytes += Math.min(left, chunk.length); } });
  return () => ({ text: Buffer.concat(chunks).toString('utf8'), truncated });
};
const out = capture(child.stdout), err = capture(child.stderr);
const code = await new Promise(resolve => { child.on('exit', code => resolve(code ?? 125)); child.on('error', () => resolve(125)); });
const files = []; let total = 0;
if (code === 0) {
  const entries = await readdir('/out', { withFileTypes: true });
  if (entries.length > 16) throw new Error('Too many output files');
  for (const entry of entries) {
    if (!entry.isFile() || !/^[^.][^/\\\0]{0,119}\.(?:csv|json|md|txt|xlsx|docx|pptx|zip|html|css|js|mjs|png|svg|pdf)$/i.test(entry.name)) continue;
    const meta = await lstat(`/out/${entry.name}`);
    if (!meta.isFile() || meta.isSymbolicLink()) throw new Error('Invalid output');
    total += meta.size; if (total > 10 * 1024 * 1024) throw new Error('Output exceeds 10 MB');
    const bytes = await readFile(`/out/${entry.name}`);
    files.push({ name: entry.name, size: bytes.length, contentBase64: bytes.toString('base64') });
  }
}
const stdout = out(), stderr = err();
clearTimeout(watchdog);
process.stdout.write(JSON.stringify({ status: code === 0 ? 'completed' : 'failed', exitCode: code, files,
  stdout: stdout.text, stderr: stderr.text, stdoutTruncated: stdout.truncated, stderrTruncated: stderr.truncated }));
