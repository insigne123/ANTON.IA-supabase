import { execFile } from 'node:child_process';
import { chown, mkdir, mkdtemp, readdir, readFile, rm, lstat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** Docker runner: one container per job, destroyed afterwards. No shell is
 * ever involved; every argument is passed as an argv array. */

const IMAGES = { python: 'cowork-exec-py:1', node: 'cowork-exec-node:1' };
const OUTPUT_EXTENSIONS = new Set(['csv', 'json', 'md', 'txt', 'xlsx', 'docx', 'pptx', 'zip', 'html', 'css', 'js', 'mjs', 'png', 'svg', 'pdf']);
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_FILES = 16;
const MAX_STREAM_BYTES = 64 * 1024;

function truncate(buffer) {
  if (buffer.length <= MAX_STREAM_BYTES) return { text: buffer.toString('utf8'), truncated: false };
  return { text: buffer.subarray(0, MAX_STREAM_BYTES).toString('utf8'), truncated: true };
}

export function dockerArgs({ container, workDir, outDir, language, timeoutMs }) {
  return ['run', '--name', container,
    '--network', 'none',
    '--memory=2g', '--memory-swap=2g',
    '--cpus=1.0',
    '--pids-limit=128',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--user', '65534:65534',
    '-e', 'PYTHONDONTWRITEBYTECODE=1',
    '-e', 'PYTHONUNBUFFERED=1',
    '-e', 'NODE_ENV=production',
    '-e', `COWORK_JOB_TIMEOUT_MS=${timeoutMs}`,
    '-e', 'HOME=/tmp',
    '-e', 'MPLCONFIGDIR=/tmp',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
    '--tmpfs', '/out:rw,noexec,nosuid,size=10m,nr_inodes=128,uid=65534,gid=65534',
    '-v', `${workDir}:/work:ro`,
    '-w', '/work',
    IMAGES[language],
    ...(language === 'python' ? ['python', '/work/launcher.py'] : ['node', '/work/launcher.mjs']),
  ];
}

function runDocker(args, timeoutMs, signal) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = execFile('docker', args, { timeout: timeoutMs, signal, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      resolve({ error, stdout: Buffer.from(stdout || ''), stderr: Buffer.from(stderr || ''), durationMs: Date.now() - started });
    });
    void child;
  });
}

export async function collectOutputs(outDir) {
  const entries = (await readdir(outDir, { withFileTypes: true })).filter(entry => entry.isFile());
  if (entries.length > MAX_OUTPUT_FILES) {
    const error = new Error(`Too many output files (max ${MAX_OUTPUT_FILES}).`);
    error.statusCode = 422;
    throw error;
  }
  const files = [];
  let total = 0;
  for (const entry of entries) {
    const dot = entry.name.lastIndexOf('.');
    const ext = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : '';
    if (!OUTPUT_EXTENSIONS.has(ext) || entry.name.startsWith('.') || entry.name.length > 120) continue;
    const full = join(outDir, entry.name);
    const metadata = await lstat(full);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Output is not a regular file.');
    const size = metadata.size;
    total += size;
    if (total > MAX_OUTPUT_BYTES) {
      const error = new Error('Output files exceed 10 MB in total.');
      error.statusCode = 422;
      throw error;
    }
    files.push({ name: entry.name, size, contentBase64: (await readFile(full)).toString('base64') });
  }
  return files;
}

export async function runJob(job, deps = {}) {
  const {
    baseDir = join(tmpdir(), 'cowork-jobs'),
    docker = runDocker,
    decodeOutputs = bytes => JSON.parse(bytes.toString('utf8')),
    dockerRm = container => new Promise((resolve, reject) => {
      execFile('docker', ['rm', '-f', container], { timeout: 10000 }, (error, _stdout, stderr) => {
        if (error && !/No such container/i.test(stderr || '')) reject(error); else resolve();
      });
    }),
  } = deps;
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const container = deps.container || `cowork-job-${stamp}`;
  await mkdir(baseDir, { recursive: true });
  const root = await mkdtemp(join(baseDir, `job-${stamp}-`));
  const workDir = join(root, 'work');
  const outDir = join(root, 'out');
  try {
  // Persist this exact temporary directory before code can run, so restart
  // reconciliation can remove its inputs after confirming the container stopped.
  await deps.onWorkspace?.(root);
  deps.signal?.throwIfAborted();
  await mkdir(workDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  // Jobs run as uid/gid 65534; the output dir must be writable by them.
  if (process.getuid) await chown(outDir, 65534, 65534);
  for (const file of job.files) {
    await writeFile(join(workDir, file.name), file.bytes, { mode: 0o444 });
  }
  const entry = job.language === 'python' ? 'main.py' : 'main.mjs';
  await writeFile(join(workDir, entry), job.code, { mode: 0o444 });
  const launcher = job.language === 'python' ? 'launcher-python.py' : 'launcher-node.mjs';
  await writeFile(join(workDir, job.language === 'python' ? 'launcher.py' : 'launcher.mjs'),
    await readFile(new URL(`./${launcher}`, import.meta.url)), { mode: 0o444 });
  const { error, stdout, stderr, durationMs } = await docker(
    dockerArgs({ container, workDir, outDir, language: job.language, timeoutMs: job.timeoutMs }),
    job.timeoutMs + 5000,
    deps.signal,
  );
  let status = 'completed';
  let exitCode = 0;
  if (deps.signal?.aborted) { status = 'cancelled'; exitCode = 137; await dockerRm(container); }
  else if (error) {
    if (error.killed || error.signal === 'SIGKILL' || error.code === 'ETIMEDOUT') {
      status = 'timeout';
      await dockerRm(container);
    } else if (error.code === 124) {
      status = 'timeout'; exitCode = 124;
    } else if (typeof error.code === 'number') {
      status = 'failed';
      exitCode = error.code;
    } else {
      status = 'failed';
      exitCode = 125;
      await dockerRm(container).catch(() => {});
    }
  }
  let files = [];
  if (status === 'completed') {
    const collected = decodeOutputs(stdout);
    if (!['completed', 'failed'].includes(collected.status) || !Array.isArray(collected.files)) throw new Error('Invalid collector result');
    let total = 0;
    const seen = new Set();
    if (collected.files.length > MAX_OUTPUT_FILES) throw new Error('Too many outputs');
    for (const file of collected.files) {
      const bytes = Buffer.from(String(file.contentBase64 || ''), 'base64');
      const name = String(file.name || '');
      if (seen.has(name) || !/^[^.][^/\\\0]{0,119}\.[a-z0-9]+$/i.test(name) || !OUTPUT_EXTENSIONS.has(name.split('.').pop().toLowerCase())
        || bytes.length !== file.size) throw new Error('Invalid collected output');
      total += bytes.length; if (total > MAX_OUTPUT_BYTES) throw new Error('Outputs exceed 10 MB');
      seen.add(name); file.sha256 = createHash('sha256').update(bytes).digest('hex');
    }
    return { ...collected, files: collected.status === 'completed' ? collected.files : [], durationMs };
  }
  const out = truncate(stdout);
  const err = truncate(stderr);
  return { status, exitCode, stdout: out.text, stdoutTruncated: out.truncated,
    stderr: err.text, stderrTruncated: err.truncated, files, durationMs };
  } finally {
  // Stop writers before collecting/cleaning; cleanup also runs if setup, copy or validation throws.
  await dockerRm(container);
  await rm(root, { recursive: true, force: true }).catch(async () => {
    // The output dir was handed to the job uid; take it back, then remove.
    try {
      if (process.getuid) await chown(outDir, process.getuid(), process.getgid());
    } catch {
      // Best effort: report results even if cleanup needs the next sweep.
    }
    await rm(root, { recursive: true, force: true });
  });
  }
}
