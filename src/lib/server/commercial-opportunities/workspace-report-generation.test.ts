import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const entry = await build({
  stdin: { contents: `export {opportunityGenerate, opportunityGenerateReport} from './src/lib/server/commercial-opportunities/workspace-ai';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'isolated-report-services', setup(builder) {
    builder.onResolve({ filter: /auth-utils|workspace-store|ai\/openai-json/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents:
      args.path.includes('auth-utils') ? `export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}` :
      args.path.includes('openai-json') ? `export async function generateStructuredWithTelemetry(){throw Error('External providers forbidden in this test')}` :
      `export function opportunityDb(result){if(result.error)throw Error('Fixture DB rejected');return result.data}`,
    }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', entry.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { opportunityGenerate, opportunityGenerateReport } = compiled.exports;
const previous = { key: process.env.ANTHROPIC_API_KEY, model: process.env.OPPORTUNITIES_REPORT_MODEL };
before(() => { process.env.ANTHROPIC_API_KEY = 'synthetic-not-a-credential'; process.env.OPPORTUNITIES_REPORT_MODEL = 'claude-sonnet-5-5'; });
after(() => {
  for (const [name, value] of Object.entries({ ANTHROPIC_API_KEY: previous.key, OPPORTUNITIES_REPORT_MODEL: previous.model })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

function fixture() {
  let reservation: any = null, saved: any = null;
  const reservations: any[] = [], settlements: any[] = [], requests: any[] = [];
  const state = { lease: true, budget: true };
  const report = { title: 'Reporte sintético', executive: 'Falta evidencia', recommendation: 'insufficient', reasons: [],
    sections: Array.from({ length: 5 }, (_, i) => ({ id: `${i}`, title: 'Sección', paragraphs: ['Prueba'], facts: [] })),
    requirements: [], tasks: [], milestones: [], risks: [], scenarios: [], questions: [], warnings: [], nextSteps: ['Subir las bases'] };
  const client = { from(table: string) {
    const query: any = { update() { return query; }, select() { return query; }, eq() { return query; }, gt() { return query; },
      async maybeSingle() { return { data: table === 'opportunity_jobs' ? state.lease ? { id: 'job' } : null : saved, error: null }; } };
    return query;
  }, async rpc(name: string, args: any) {
    if (name === 'opportunity_budget_reserve') {
      reservations.push(args); const fresh = !reservation; reservation ??= { id: 'reservation', admitted: state.budget };
      return { data: { ...reservation, fresh }, error: null };
    }
    if (name === 'opportunity_budget_settle') { settlements.push(args); saved = args.p_data ? { data: args.p_data } : null; return { data: true, error: null }; }
    throw Error('Unexpected RPC');
  } };
  const job = { id: 'job', organization_id: 'org', lease_token: 'lease', payload: {}, kind: 'research' };
  const input = { step: 'synthesis-envelope-v1:fixture', prompt: 'Contrato y hechos sintéticos', output: 16_000 };
  let json = JSON.stringify(report), error: Error | null = null;
  const generate = async (options: any) => {
    requests.push(options); if (error) throw error;
    return { data: options.schema.parse({ json }), telemetry: { modelName: 'claude-sonnet-5-5', durationMs: 1,
      usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } } } };
  };
  return { client, job, input, report, state, requests, reservations, settlements, generate,
    setJson(value: string) { json = value; }, setError(value: Error) { error = value; } };
}

test('one reserved report call uses the envelope and replays without another call or settlement', async () => {
  const f = fixture();
  assert.deepEqual(await opportunityGenerateReport(f.client, f.job, f.input, f.generate), f.report);
  assert.deepEqual(await opportunityGenerateReport(f.client, f.job, f.input, f.generate), f.report);
  assert.equal(f.requests.length, 1); assert.equal(f.settlements.length, 1);
  assert.deepEqual(Object.keys(f.requests[0].schema.shape), ['json']);
  assert.equal(f.requests[0].maxAttempts, 1); assert.equal(f.requests[0].allowDefaultModelFallback, false);
  assert.equal(f.requests[0].reasoningEffort, 'medium');
  assert.equal(f.reservations[0].p_lease, 'lease'); assert.equal(f.reservations[0].p_category, 'research');
  assert.ok(f.reservations[0].p_micro >= 240_000, 'reserve includes report and reasoning output');
  assert.ok(f.settlements[0].p_cost > 0); assert.deepEqual(f.settlements[0].p_data, { json: JSON.stringify(f.report) });
});

test('a seven-document report stays under the 0.75 USD cap of one research, and the reserve still bounds its cost', async () => {
  const f = fixture();
  const prompt = 'á'.repeat(60_000); // 120 kB of UTF-8, the size of the synthesis that was refused in production
  await opportunityGenerateReport(f.client, f.job, { ...f.input, prompt }, f.generate);
  const bytes = Buffer.byteLength(prompt, 'utf8');
  // Sonnet: 2 USD per million input tokens, 10 per million output, 24k output with reasoning; bytes bound tokens.
  assert.ok(f.reservations[0].p_micro >= bytes * 2 + 24_000 * 10, 'the documents and the whole output stay reserved');
  assert.ok(f.reservations[0].p_micro <= 727_000, `fits next to the reading steps (${f.reservations[0].p_micro})`);
});

test('invalid inner JSON keeps the paid receipt and result, does not expose source text or retry', async () => {
  const f = fixture(); f.setJson('{"PRIVATE_SOURCE_SENTINEL":');
  const safeError = (error: any) => error.status === 503 && !error.message.includes('PRIVATE_SOURCE_SENTINEL');
  await assert.rejects(opportunityGenerateReport(f.client, f.job, f.input, f.generate), safeError);
  await assert.rejects(opportunityGenerateReport(f.client, f.job, f.input, f.generate), safeError);
  assert.equal(f.requests.length, 1); assert.equal(f.settlements.length, 1);
  assert.ok(f.settlements[0].p_cost > 0); assert.equal(f.settlements[0].p_data.json, '{"PRIVATE_SOURCE_SENTINEL":');
});

test('valid JSON with an invalid report contract is rejected after accounting the response', async () => {
  const f = fixture(); f.setJson(JSON.stringify({ ...f.report, sections: [], recommendation: 'automatically_bid' }));
  await assert.rejects(opportunityGenerateReport(f.client, f.job, f.input, f.generate), (error: any) => error.status === 503);
  assert.equal(f.requests.length, 1); assert.ok(f.settlements[0].p_cost > 0);
});

test('uncertain provider failure keeps its reserve and blocks a blind retry', async () => {
  const f = fixture(); f.setError(Error('Uncertain provider timeout'));
  await assert.rejects(opportunityGenerateReport(f.client, f.job, f.input, f.generate));
  await assert.rejects(opportunityGenerateReport(f.client, f.job, f.input, f.generate), /conciliación/);
  assert.equal(f.requests.length, 1); assert.equal(f.settlements[0].p_cost, null);
});

test('lease or budget refusal stops before contacting the provider', async () => {
  for (const field of ['lease', 'budget'] as const) {
    const f = fixture(); f.state[field] = false;
    await assert.rejects(opportunityGenerateReport(f.client, f.job, f.input, f.generate));
    assert.equal(f.requests.length, 0); assert.equal(f.settlements.length, 0);
  }
});

test('an image or a scanned PDF goes with the call, and its pages are reserved at the cache-write price', async () => {
  const f = fixture();
  const { z } = await import('zod');
  const schema = z.object({ pages: z.array(z.object({ page: z.number(), text: z.string() })) });
  const generate = async (options: any) => { f.requests.push(options);
    return { data: { pages: [{ page: 1, text: '[Captura de la tienda]' }] }, telemetry: { modelName: 'claude-haiku-5-5', durationMs: 1,
      usage: { prompt_tokens: 2000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } } } }; };
  const attachments = [{ kind: 'pdf', mediaType: 'application/pdf', data: 'JVBERi0=' }];
  const plain = fixture();
  await opportunityGenerate(plain.client, plain.job, { step: 'scan:plain', category: 'research', role: 'extract', schema, prompt: 'Transcribe', output: 3000 }, generate);
  await opportunityGenerate(f.client, f.job, { step: 'scan:doc:1', category: 'research', role: 'extract', schema, prompt: 'Transcribe', output: 3000,
    attachments, attachmentTokens: 75_000 }, generate);
  assert.deepEqual(f.requests.at(-1).attachments, attachments, 'the file reaches the model');
  assert.equal('attachments' in f.requests[0] ? f.requests[0].attachments : undefined, undefined, 'a call without files sends none');
  // Haiku: 0.2 USD per million tokens written to the cache.
  assert.equal(f.reservations[0].p_micro - plain.reservations[0].p_micro, 75_000 * 0.2);
  await assert.rejects(opportunityGenerate(fixture().client, f.job, { step: 'scan:big', category: 'research', role: 'extract', schema, prompt: 'Transcribe',
    attachments, attachmentTokens: 100_000 }, generate), /dividirse/, 'Haiku stays under its 100k input threshold');
  const previous = { model: process.env.OPPORTUNITIES_EXTRACT_MODEL, key: process.env.OPENAI_API_KEY };
  process.env.OPPORTUNITIES_EXTRACT_MODEL = 'gpt-6-luna'; process.env.OPENAI_API_KEY = 'synthetic-not-a-credential';
  try {
    await assert.rejects(opportunityGenerate(fixture().client, f.job, { step: 'scan:luna', category: 'research', role: 'extract', schema, prompt: 'Transcribe',
      attachments, attachmentTokens: 3000 }, generate), /no lee imágenes/);
  } finally {
    for (const [name, value] of Object.entries({ OPPORTUNITIES_EXTRACT_MODEL: previous.model, OPENAI_API_KEY: previous.key })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
