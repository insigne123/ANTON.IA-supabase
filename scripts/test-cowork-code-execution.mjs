// No secrets, environment files or providers: exercises code staging/execution.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
process.env.COWORK_ENABLED = 'true';
const state = {
  listed: [{ name: 'in.csv' }], downloads: {}, uploads: [], events: [],
  staged: null, executor: null, executorStatus: 200,
};
const client = {
  storage: {
    from: bucket => ({
      list: async prefix => {
        if (bucket !== 'cowork-uploads') return { data: [], error: null };
        return { data: state.listed, error: null };
      },
      download: async path => {
        const body = state.downloads[path];
        if (!body) return { data: null, error: { message: 'missing' } };
        return { data: { arrayBuffer: async () => Buffer.from(body) }, error: null };
      },
      upload: async (path, bytes, options) => {
        state.uploads.push({ path, size: bytes.length });
        return { data: { path }, error: null };
      },
    }),
  },
  from: table => {
    const chain = {
      select: () => chain, eq: () => chain,
      upsert: values => {
        state.staged = values;
        return { ...chain, select: () => ({ ...chain, maybeSingle: async () => ({ data: { run_id: 'run-code' }, error: null }) }) };
      },
      maybeSingle: async () => {
        if (table === 'cowork_code_proposals') {
          return state.staged
            ? { data: { language: state.staged.language, code: state.staged.code, input_files: state.staged.input_files, code_hash: state.staged.code_hash }, error: null }
            : { data: null, error: null };
        }
        return { data: null, error: null };
      },
      insert: async row => { state.events.push(row); return { data: null, error: null }; },
    };
    return chain;
  },
};
const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>globalThis.__coworkCode.client;',
  './runs': `export const getCoworkRun=async()=>({run:{status:'completed'},events:[]});`,
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
};
globalThis.__coworkCode = { client, state };
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://exec.example/v1/jobs');
  assert.match(options.headers.authorization, /^Bearer /);
  const body = JSON.parse(options.body);
  assert.match(body.idempotencyKey, /^cowork-code-run-code$/);
  if (state.executorStatus !== 200) return { ok: false, status: state.executorStatus, json: async () => ({ error: 'busy' }) };
  return { ok: true, status: 200, json: async () => state.executor };
};
process.env.COWORK_EXECUTOR_URL = 'https://exec.example';
process.env.COWORK_EXECUTOR_SECRET = 'test-secret';
const bundle = await build({ entryPoints: ['src/lib/server/cowork/code-runner.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-services', setup(build) {
    build.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const auth = { user: { id: 'owner' }, organizationId: 'org', supabase: client };
const scope = { userId: 'owner', organizationId: 'org' };
const proposal = { language: 'python', code: 'print("hi")', inputFiles: ['in.csv'] };
try {
  // Staging rejects files that are not uploaded for this run.
  await assert.rejects(module.exports.stageCoworkCode(scope, 'run-code', { ...proposal, inputFiles: ['ghost.csv'] }), /no está subido/);
  assert.equal(state.staged, null);
  const staged = await module.exports.stageCoworkCode(scope, 'run-code', proposal);
  assert.equal(staged.files, 1);
  assert.ok(state.staged);
  const target = `code:${state.staged.code_hash}`;

  // Success promotes artifacts and records one event per file.
  state.downloads[`org/owner/run-code/in.csv`] = 'a,b';
  state.executor = { status: 'completed', exitCode: 0, stdout: 'unique=2', stderr: '',
    files: [{ name: 'clean.csv', size: 3, contentBase64: Buffer.from('a,b').toString('base64') }],
    durationMs: 900 };
  const done = await module.exports.executeCoworkCode(auth, 'run-code', target);
  assert.match(done.reply, /entorno aislado/);
  assert.match(done.reply, /clean\.csv/);
  assert.equal(done.result.files.length, 1);
  assert.equal(state.uploads.length, 1);
  assert.ok(state.uploads[0].path.startsWith('org/owner/run-code/clean.csv'));
  assert.equal(state.events.filter(event => event.kind === 'artifact.created').length, 1);

  // Drift refuses even though a row exists.
  await assert.rejects(module.exports.executeCoworkCode(auth, 'run-code', `code:${'0'.repeat(64)}`), /cambió desde tu revisión/);

  // Busy executor asks for a later retry instead of failing silently.
  state.executorStatus = 409;
  await assert.rejects(module.exports.executeCoworkCode(auth, 'run-code', target), /ocupado/);
  state.executorStatus = 200;

  // Executor output with a bad filename is rejected, never stored.
  state.executor = { status: 'completed', exitCode: 0, stdout: '', stderr: '',
    files: [{ name: '../evil.sh', size: 1, contentBase64: Buffer.from('x').toString('base64') }], durationMs: 10 };
  const before = state.uploads.length;
  await assert.rejects(module.exports.executeCoworkCode(auth, 'run-code', target), /inválido/);
  assert.equal(state.uploads.length, before);

  // Zip-family outputs must be real containers, not renamed text.
  state.executor = { status: 'completed', exitCode: 0, stdout: '', stderr: '',
    files: [{ name: 'informe.docx', size: 4, contentBase64: Buffer.from('nope').toString('base64') }], durationMs: 10 };
  await assert.rejects(module.exports.executeCoworkCode(auth, 'run-code', target), /no es un documento válido/);
  const minimalZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml')]);
  state.executor = { status: 'completed', exitCode: 0, stdout: '', stderr: '',
    files: [{ name: 'informe.docx', size: minimalZip.length, contentBase64: minimalZip.toString('base64') }], durationMs: 10 };
  const promoted = await module.exports.executeCoworkCode(auth, 'run-code', target);
  assert.equal(promoted.result.files[0].name, 'informe.docx');
  // A plain user-built zip (no OOXML marker) is a valid archive, not a fake.
  const plainZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x41, 0x42]);
  state.executor = { status: 'completed', exitCode: 0, stdout: '', stderr: '',
    files: [{ name: 'paquete.zip', size: plainZip.length, contentBase64: plainZip.toString('base64') }], durationMs: 10 };
  const promotedZip = await module.exports.executeCoworkCode(auth, 'run-code', target);
  assert.equal(promotedZip.result.files[0].name, 'paquete.zip');

  // Timeout surfaces as a Spanish error without auto-retry.
  state.executor = { status: 'timeout', exitCode: 0, stdout: 'partial', stderr: '', files: [], durationMs: 120000 };
  await assert.rejects(module.exports.executeCoworkCode(auth, 'run-code', target), /tiempo máximo/);

  // Missing configuration fails closed before touching anything.
  delete process.env.COWORK_EXECUTOR_SECRET;
  await assert.rejects(module.exports.executeCoworkCode(auth, 'run-code', target), /no está configurada/);
  process.env.COWORK_EXECUTOR_SECRET = 'test-secret';

  console.log('PASS: staging gate, hash-bound execution, artifact promotion, drift refusal, busy/timeout handling, config gate.');
} finally {
  delete globalThis.__coworkCode;
  delete globalThis.fetch;
  delete process.env.COWORK_EXECUTOR_URL;
  delete process.env.COWORK_EXECUTOR_SECRET;
}
