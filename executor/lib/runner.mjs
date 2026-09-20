import { execFile } from 'node:child_process';
import { chown, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Docker runner: one container per job, destroyed afterwards. No shell is
 * ever involved; every argument is passed as an argv array. */

const IMAGES = { python: 'cowork-exec-py:1', node: 'cowork-exec-node:1' };
const OUTPUT_EXTENSIONS = new Set(['csv', 'json', 'md', 'txt', 'xlsx', 'docx', 'pptx', 'zip', 'html', 'png', 'svg', 'pdf']);
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_FILES = 16;
const MAX_STREAM_BYTES = 64 * 1024;

function truncate(buffer) {
  if (buffer.length <= MAX_STREAM_BYTES) return { text: buffer.toString('utf8'), truncated: false };
  return { text: buffer.subarray(0, MAX_STREAM_BYTES).toString('utf8'), truncated: true };
}

export function dockerArgs({ container, workDir, outDir, language, timeoutMs }) {
  return ['run', '--rm', '--name', container,
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
    '-e', 'HOME=/tmp',
    '-e', 'MPLCONFIGDIR=/tmp',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
    '-v', `${workDir}:/work:ro`,
    '-v', `${outDir}:/out:rw`,
    '-w', '/work',
    IMAGES[language],
    ...(language === 'python' ? ['python', '/work/main.py'] : ['node', '/work/main.mjs']),
  ];
}

function runDocker(args, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = execFile('docker', args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
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
    const size = (await stat(full)).size;
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
    listOutputs = collectOutputs,
    dockerRm = container => new Promise(resolve => {
      execFile('docker', ['rm', '-f', container], () => resolve());
    }),
  } = deps;
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const container = `cowork-job-${stamp}`;
  const root = await mkdtemp(join(baseDir, `job-${stamp}-`));
  const workDir = join(root, 'work');
  const outDir = join(root, 'out');
  await mkdir(workDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  // Jobs run as uid/gid 65534; the output dir must be writable by them.
  await chown(outDir, 65534, 65534);
  for (const file of job.files) {
    await writeFile(join(workDir, file.name), file.bytes, { mode: 0o444 });
  }
  const entry = job.language === 'python' ? 'main.py' : 'main.mjs';
  await writeFile(join(workDir, entry), job.code, { mode: 0o444 });
  const { error, stdout, stderr, durationMs } = await docker(
    dockerArgs({ container, workDir, outDir, language: job.language, timeoutMs: job.timeoutMs }),
    job.timeoutMs + 5000,
  );
  let status = 'completed';
  let exitCode = 0;
  if (error) {
    if (error.killed || error.signal === 'SIGKILL' || error.code === 'ETIMEDOUT') {
      status = 'timeout';
      await dockerRm(container);
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
  if (status !== 'timeout') {
    try {
      files = await listOutputs(outDir);
    } catch (listError) {
      if (listError?.statusCode) throw listError;
      files = [];
    }
  }
  await rm(root, { recursive: true, force: true }).catch(async () => {
    // The output dir was handed to the job uid; take it back, then remove.
    try {
      await chown(outDir, process.getuid(), process.getgid());
    } catch {
      // Best effort: report results even if cleanup needs the next sweep.
    }
    await rm(root, { recursive: true, force: true });
  });
  const out = truncate(stdout);
  const err = truncate(stderr);
  return { status, exitCode, stdout: out.text, stdoutTruncated: out.truncated,
    stderr: err.text, stderrTruncated: err.truncated, files, durationMs };
}
