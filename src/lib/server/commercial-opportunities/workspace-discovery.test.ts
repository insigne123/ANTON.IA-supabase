import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «Actualizar oportunidades» (requestOpportunityDiscovery) with an in-memory client: what it queues, and why it does not.
const STUBBED = /^\.\/(workspace-ai|workspace-sources|workspace-research|workspace-pipeline|workspace-offer|purchase-plan|workspace-assistant|workspace-tender-profile|workspace-fit|workspace-market|workspace-summaries|workspace-prefill|workspace-scans|workspace-results|workspace-access|workspace-store)$|auth-utils$/;
const entry = await build({
  stdin: { contents: `export { requestOpportunityDiscovery } from './src/lib/server/commercial-opportunities/workspace-jobs';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'isolated-discovery', setup(builder) {
    builder.onResolve({ filter: STUBBED }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path.includes('auth-utils')
      ? 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}'
      : args.path.endsWith('workspace-store')
        ? 'export function opportunityDb(result){ if (result.error) throw new Error(result.error.message); return result.data; }'
        : args.path.endsWith('workspace-access') ? 'export function assertOpportunityAdmin(scope){ if (scope.role !== "admin" && scope.role !== "owner") throw new Error("solo administradores"); }'
          : args.path.endsWith('purchase-plan') ? 'export async function enqueueMonthlyDemand(){ globalThis.__monthly.push("demand"); } export async function runOpportunityDemand(){}'
            : args.path.endsWith('workspace-market') ? 'export async function enqueueMonthlyContracts(){ globalThis.__monthly.push("contracts"); } export async function runMarketContracts(){} export async function runWinPlan(){}'
              : 'export const opportunityGenerate=()=>{}, criteriaSchema={}, captureOpportunityLinkedIn=()=>{}, captureOpportunityTenders=()=>{}, evaluateOpportunityBatch=()=>{}, runOpportunityResearch=()=>{}, runOpportunityChat=()=>{}, applyAutomaticMove=()=>{}, runPipelineReview=()=>{}, runOpportunityOffer=()=>{}, runOpportunityAssistant=()=>{}, runTenderProfileSuggestion=()=>{}, enqueueFitAfterReport=()=>{}, runRequirementFit=()=>{}, runOpportunitySummaries=()=>{}, runOpportunityPrefill=()=>{}, runDocumentScan=()=>{}, runResultChecks=()=>{};' }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', entry.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { requestOpportunityDiscovery } = compiled.exports;

// 24 Oct 2026, 15:30 UTC: 12:30 in Santiago (summer time).
const NOW = Date.parse('2026-10-24T15:30:00Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const admin = { organizationId: 'org', userId: 'u-admin', role: 'admin' };
const CONTEXT = { revision: 3, criteria: { postQueries: ['aseo industrial'], roles: ['operario de aseo'] } };

function fakeClient(context: unknown, jobs: Array<{ kind: string; state: string; updated_at: string }>, existingKeys: string[] = []) {
  const keys = new Set(existingKeys); const queued: Array<{ kind: string; dedupe_key: string; payload: unknown }> = [];
  (globalThis as any).__monthly = [];
  const from = (table: string) => {
    if (table === 'opportunity_company_context') { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: context, error: null }) }; return q; }
    assert.equal(table, 'opportunity_jobs');
    let row: any = null;
    const q: any = { select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
      upsert: (value: any, options: any) => { assert.deepEqual(options, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }); row = value; return q; },
      then: (resolve: any) => {
        if (!row) return Promise.resolve({ data: jobs, error: null }).then(resolve);
        const added = !keys.has(row.dedupe_key); keys.add(row.dedupe_key); if (added) queued.push(row);
        return Promise.resolve({ data: added ? [{ id: row.dedupe_key }] : [], error: null }).then(resolve);
      } };
    return q;
  };
  return { client: { from }, queued };
}

test('pressed with nothing searched today, every source searches, with this hour\'s key', async () => {
  const { client, queued } = fakeClient(CONTEXT, []);
  const result = await requestOpportunityDiscovery(client, admin, NOW);
  assert.deepEqual(result, { queued: ['tenders', 'hiring', 'posts'], searching: [], fresh: [], later: [] });
  assert.deepEqual(queued.map(job => job.dedupe_key), ['manual:2026-10-24:12:3:tenders', 'manual:2026-10-24:12:3:hiring', 'manual:2026-10-24:12:3:posts']);
  assert.deepEqual(queued[0].payload, { revision: 3 });
  assert.deepEqual((globalThis as any).__monthly, ['demand', 'contracts']);
});

test('a source searching now or searched less than an hour ago waits; one that failed, or searched this morning, searches again', async () => {
  const { client, queued } = fakeClient(CONTEXT, [
    { kind: 'tenders', state: 'running', updated_at: minutesAgo(2) },
    { kind: 'posts', state: 'ready', updated_at: minutesAgo(20) },
    { kind: 'hiring', state: 'failed', updated_at: minutesAgo(180) },
    { kind: 'posts', state: 'failed', updated_at: minutesAgo(300) },
  ]);
  assert.deepEqual(await requestOpportunityDiscovery(client, admin, NOW), { queued: ['hiring'], searching: ['tenders'], fresh: ['posts'], later: [] });
  assert.deepEqual(queued.map(job => job.kind), ['hiring']);
  const morning = fakeClient(CONTEXT, [{ kind: 'tenders', state: 'ready', updated_at: minutesAgo(270) }]);
  assert.deepEqual((await requestOpportunityDiscovery(morning.client, admin, NOW)).queued, ['tenders', 'hiring', 'posts']);
});

test('pressed again in the same hour after a failure, nothing is queued twice and it says so', async () => {
  const { client, queued } = fakeClient(CONTEXT, [{ kind: 'tenders', state: 'failed', updated_at: minutesAgo(5) }], ['manual:2026-10-24:12:3:tenders']);
  const result = await requestOpportunityDiscovery(client, admin, NOW);
  assert.deepEqual(result.later, ['tenders']);
  assert.deepEqual(queued.map(job => job.kind), ['hiring', 'posts']);
});

test('without criteria yet, the button prepares them; without an offer or as a member, it is refused', async () => {
  const { client, queued } = fakeClient({ revision: 1, criteria: {} }, []);
  assert.deepEqual((await requestOpportunityDiscovery(client, admin, NOW)).queued, ['criteria']);
  assert.equal(queued[0].dedupe_key, 'manual:2026-10-24:12:1:criteria');
  await assert.rejects(requestOpportunityDiscovery(fakeClient(null, []).client, admin, NOW), /Confirma primero la oferta/);
  await assert.rejects(requestOpportunityDiscovery(fakeClient(CONTEXT, []).client, { ...admin, role: 'member' }, NOW), /solo administradores/);
});
