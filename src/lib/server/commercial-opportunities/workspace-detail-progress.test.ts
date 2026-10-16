import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// readOpportunityDetail with an in-memory client: the page gets each report's progress, never the job's payload.
const entry = await build({
  stdin: { contents: `export { readOpportunityDetail } from './src/lib/server/commercial-opportunities/workspace-store';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'isolated-detail', setup(builder) {
    builder.onResolve({ filter: /auth-utils$|\.\/workspace-access$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path.includes('auth-utils')
      ? 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}'
      : 'export async function assertOpportunityRead(){} export async function assertOpportunityAdmin(){} export async function readableOpportunityIds(){return null}' }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', entry.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { readOpportunityDetail } = compiled.exports;

const rows: Record<string, unknown> = {
  commercial_opportunities: { id: 'op', kind: 'tender', title: 'Servicio de traslado' },
  opportunity_documents: [{ id: 'd1', name: 'Bases.pdf', storage_path: 'org/op/bases.pdf' }],
  opportunity_jobs: [
    { id: 'j1', kind: 'research', state: 'running', error: null, payload: { progress: { stage: 'read', read: 2, total: 5, document: 'Bases.pdf' },
      documentIds: ['d1'], attachmentsUrl: 'https://example.test/private', profileRevision: 3 } },
    { id: 'j2', kind: 'chat', state: 'ready', error: null, payload: { requestId: 'r1' } },
  ],
  opportunity_company_context: { criteria: {} },
};
const client = {
  from(table: string) {
    const data = rows[table] ?? (['opportunity_work'].includes(table) ? null : []);
    const result = { data, error: null };
    const chain: any = new Proxy({}, { get: (_target, name) => name === 'then' ? (resolve: any) => resolve(result)
      : name === 'single' || name === 'maybeSingle' ? async () => result : () => chain });
    return chain;
  },
};

test('a report job carries its progress for the office; no job carries its payload', async () => {
  const detail = await readOpportunityDetail(client, { organizationId: 'org', userId: 'u1', role: 'admin' }, 'op');
  assert.deepEqual(detail.jobs, [
    { id: 'j1', kind: 'research', state: 'running', error: null, progress: { stage: 'read', read: 2, total: 5, document: 'Bases.pdf', since: null } },
    { id: 'j2', kind: 'chat', state: 'ready', error: null },
  ]);
  assert.doesNotMatch(JSON.stringify(detail), /example\.test|profileRevision|documentIds|storage_path/);
});
