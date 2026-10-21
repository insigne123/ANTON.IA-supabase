import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { call, reply, ScriptedModel, usageOf } from '@/lib/agent-harness/scripted';

// The report's second reading with the ledger and the model in memory.
const entry = await build({
  stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-verify';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'isolated-verify-services', setup(builder) {
    builder.onResolve({ filter: /auth-utils|workspace-store|ai\/openai-json/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents:
      args.path.includes('auth-utils') ? `export class AuthError extends Error {constructor(message,status){super(message);this.status=status;this.name='AuthError'}}` :
      args.path.includes('openai-json') ? `export async function generateStructuredWithTelemetry(){throw Error('External providers forbidden in this test')}` :
      `export function opportunityDb(result){if(result.error)throw Error('Fixture DB rejected');return result.data}`,
    }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', entry.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { opportunityVerifyEnabled, verifyReportClaims, verifiedWarning } = compiled.exports;

const says = (content: any) => ({ ...reply(content, undefined, usageOf(2000, 400)), model: 'claude-haiku-5-5' });
function ledger(options: { budget?: boolean } = {}) {
  const steps = new Map<string, string>(); const settlements: any[] = []; const reservations: any[] = [];
  const client = {
    from() { const q: any = { update: () => q, eq: () => q, gt: () => q, select: () => q, maybeSingle: async () => ({ data: { id: 'job' }, error: null }) }; return q; },
    async rpc(name: string, args: any) {
      if (name === 'opportunity_budget_reserve') {
        reservations.push(args);
        if (options.budget === false) return { data: { admitted: false }, error: null };
        const id = `res-${steps.size + 1}`; steps.set(args.p_step, id); return { data: { admitted: true, fresh: true, id, state: 'reserved' }, error: null };
      }
      settlements.push(args); return { data: true, error: null };
    },
  } as any;
  return { client, settlements, reservations, job: { id: 'job', organization_id: 'org', opportunity_id: 'op1', requested_by: 'u1', lease_token: 'lease', kind: 'research', payload: {} } };
}

const quote = (chunkId: string, text: string) => ({ chunkId, quote: text });
const chunks = [
  { id: 'c1', document_id: 'd1', locator: 'p. 2', ordinal: 1, content: 'La garantía de seriedad de la oferta será de 5% del monto de la oferta.' },
  { id: 'c3', document_id: 'd1', locator: 'p. 1', ordinal: 0, content: 'El plazo de entrega de las propuestas vence el 16 de octubre.' },
];
const report = () => ({
  requirements: [{ title: 'Boleta de garantía de seriedad', status: 'supported' as const, evidence: [quote('c1', 'garantía de seriedad de la oferta será de 5%')], action: '', role: '', due: '' }],
  milestones: [{ label: 'Adjudicación', date: '30 de octubre', state: 'documented' as const, citations: [quote('c3', 'vence el 16 de octubre')] }],
  risks: [], sections: [],
});

test('the second reading is on only with the agents, its own flag and a Claude specialist', () => {
  const on = { OPPORTUNITIES_RUNTIME: 'harness', OPPORTUNITIES_REPORT_VERIFY: 'on', ANTHROPIC_API_KEY: 'key' };
  assert.equal(opportunityVerifyEnabled(on), true);
  assert.equal(opportunityVerifyEnabled({ ...on, OPPORTUNITIES_REPORT_VERIFY: undefined }), false);
  assert.equal(opportunityVerifyEnabled({ ...on, OPPORTUNITIES_RUNTIME: undefined }), false);
  assert.equal(opportunityVerifyEnabled({ ...on, ANTHROPIC_API_KEY: '' }), false);
  assert.equal(opportunityVerifyEnabled({ ...on, OPPORTUNITIES_SPECIALIST_MODEL: 'gpt-6-luna' }), false);
});

test('a claim whose quote is about something else goes back to «por confirmar»; a supported one stays; the model may read the whole fragment first', async () => {
  const f = ledger();
  const model = new ScriptedModel([
    says([call('leer_fragmento', { chunkId: 'c3' }, 'a')]),
    says([call('entregar', { results: [{ id: 'req:0', verdict: 'supports', reason: 'La cita da el 5%.' }, { id: 'mile:0', verdict: 'unrelated', reason: 'La cita es del cierre de ofertas, no de la adjudicación.' }] }, 'b')]),
  ]);
  const result = await verifyReportClaims(f.client, f.job, report(), chunks, { timeoutMs: 20_000, base: model });
  assert.equal(result.checked, 2);
  assert.equal(result.downgraded, 1);
  assert.equal(result.report.requirements[0].status, 'supported');
  assert.equal(result.report.milestones[0].state, 'unknown');
  assert.match(JSON.stringify(model.requests[1].messages), /El plazo de entrega de las propuestas vence el 16 de octubre/, 'the fragment it asked for came back');
  assert.match(String(model.requests[0].messages[0].content), /Boleta de garantía de seriedad[\s\S]*Adjudicación/);
  assert.ok(f.reservations.every(r => r.p_category === 'research' && /^verify:[0-9a-f]{24}:r[12]$/.test(r.p_step)), 'its rounds are steps of the research ledger');
});

test('a reading that leaves a claim unanswered is sent back; one that cannot run leaves the report as written', async () => {
  const f = ledger();
  const model = new ScriptedModel([
    says([call('entregar', { results: [{ id: 'req:0', verdict: 'supports', reason: 'Ok.' }] }, 'a')]),
    says([call('entregar', { results: [{ id: 'req:0', verdict: 'supports', reason: 'Ok.' }, { id: 'mile:0', verdict: 'partial', reason: 'Falta contexto.' }] }, 'b')]),
  ]);
  const checked = await verifyReportClaims(f.client, f.job, report(), chunks, { timeoutMs: 20_000, base: model });
  assert.match(JSON.stringify(model.requests[1].messages), /Faltan afirmaciones por revisar: mile:0/);
  assert.equal(checked.downgraded, 0, 'a doubt changes nothing');
  assert.equal(checked.report.milestones[0].state, 'documented');

  const broke = ledger({ budget: false });
  const untouched = report();
  const refused = await verifyReportClaims(broke.client, broke.job, untouched, chunks, { timeoutMs: 20_000, base: new ScriptedModel([says('hola')]) });
  assert.equal(refused.report, untouched, 'no budget: the report goes out as it was');
  assert.deepEqual([refused.checked, refused.downgraded], [0, 0]);

  const none = await verifyReportClaims(f.client, f.job, { requirements: [], milestones: [], risks: [], sections: [] }, chunks, { timeoutMs: 20_000, base: new ScriptedModel([]) });
  assert.equal(none.checked, 0, 'nothing documented, nothing to read');
  assert.match(verifiedWarning(1), /Una afirmación/);
  assert.match(verifiedWarning(3), /3 afirmaciones/);
});
