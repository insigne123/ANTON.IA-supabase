import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// readWorkspaceOverview with an in-memory client that answers each read after a pause: the independent reads go together.
const entry = await build({
  stdin: { contents: `export { readWorkspaceOverview } from './src/lib/server/commercial-opportunities/workspace-store';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'isolated-overview', setup(builder) {
    builder.onResolve({ filter: /auth-utils$|\.\/workspace-access$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path.includes('auth-utils')
      ? 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}'
      : 'export async function assertOpportunityRead(){} export async function assertOpportunityAdmin(){} export async function readableOpportunityIds(){return null}' }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', entry.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { readWorkspaceOverview } = compiled.exports;

const rows: Record<string, unknown> = {
  opportunity_workspace_list: [{ id: 'op1', title: 'Servicio de traslado' }],
  opportunity_work: [{ opportunity_id: 'op1', status: 'working' }],
  opportunity_notifications: [{ id: 'n1', opportunity_id: 'op1', title: 'Informe listo', created_at: '2026-10-15T21:42:00Z', read_at: null }],
  organization_reporting_groups: [{ id: 'g1', name: 'Licitaciones' }],
  opportunity_company_context: { offer: 'Logística' },
  opportunity_budget_months: { spent_micro_usd: 2_140_000, reserved_micro_usd: 0 },
  organization_members: [{ user_id: 'u1', role: 'admin' }],
  profiles: [{ id: 'u1', full_name: 'Pruebas ANTON.IA' }],
};
function slowClient() {
  const state = { inFlight: 0, most: 0, order: [] as string[] };
  const answer = (name: string) => {
    state.inFlight++; state.most = Math.max(state.most, state.inFlight); state.order.push(name);
    return new Promise(resolve => setTimeout(() => { state.inFlight--; resolve({ data: rows[name] ?? null, error: null }); }, 30));
  };
  const chain = (name: string): any => new Proxy({}, { get: (_target, key) => key === 'then'
    ? (resolve: any, reject: any) => answer(name).then(resolve, reject)
    : key === 'single' || key === 'maybeSingle' ? () => answer(name) : () => chain(name) });
  return { state, client: { from: (table: string) => chain(table), rpc: (name: string) => chain(name) } };
}

test('the overview reads its parts together and still answers the same', async () => {
  const { state, client } = slowClient();
  const overview = await readWorkspaceOverview(client, { organizationId: 'org', userId: 'u1', role: 'admin' }, { view: 'recommended' });
  // The list, notifications, teams, offer, budget and members at once; the work records after the list.
  assert.ok(state.most >= 6, `at most ${state.most} reads at once`);
  assert.equal(state.order.at(-1), 'opportunity_work');
  assert.deepEqual({ ...overview, sourceStatus: undefined }, {
    mode: 'management', items: rows.opportunity_workspace_list, work: rows.opportunity_work, notifications: rows.opportunity_notifications,
    members: [{ user_id: 'u1', role: 'admin', name: 'Pruebas ANTON.IA' }], groups: rows.organization_reporting_groups, context: rows.opportunity_company_context,
    budget: { spent: 2.14, reserved: 0, cap: 20 }, sourceStatus: undefined, documentAlerts: [],
  });
});

test('someone who is not an admin gets the assigned view without the admin reads', async () => {
  const { state, client } = slowClient();
  const overview = await readWorkspaceOverview(client, { organizationId: 'org', userId: 'u1', role: 'member' }, {});
  assert.equal(overview.mode, 'assigned');
  assert.deepEqual([overview.members, overview.groups, overview.context], [[], [], null]);
  assert.deepEqual(state.order.filter(name => /reporting_groups|company_context|budget|members|profiles/.test(name)), []);
});

test('a source picked reads the list with its kinds; without one, the list as it always was', async () => {
  const { state, client } = slowClient();
  rows.opportunity_workspace_list_kinds = [{ id: 'op2', title: 'Avisos de guardias' }];
  const filtered = await readWorkspaceOverview(client, { organizationId: 'org', userId: 'u1', role: 'admin' }, { view: 'all', kinds: ['hiring', 'linkedin_post'] });
  assert.deepEqual(filtered.items, [{ id: 'op2', title: 'Avisos de guardias' }]);
  assert.ok(state.order.includes('opportunity_workspace_list_kinds') && !state.order.includes('opportunity_workspace_list'));
});

test('a line of service reads the list with its words and, before that function exists, narrows the list it already has', async () => {
  const { state, client } = slowClient();
  const admin = { organizationId: 'org', userId: 'u1', role: 'admin' };
  rows.opportunity_workspace_list_terms = [{ id: 'op3', title: 'Servicio de guardias' }];
  const read = await readWorkspaceOverview(client, admin, { view: 'all', categories: ['seguridad'] });
  assert.deepEqual(read.items, [{ id: 'op3', title: 'Servicio de guardias' }]);
  assert.ok(state.order.includes('opportunity_workspace_list_terms') && !state.order.includes('opportunity_workspace_list'));
  const none = slowClient();
  rows.opportunity_workspace_list = [{ id: 'a', title: 'Servicio de guardias de seguridad' }, { id: 'b', title: 'Servicio de aseo' }];
  delete rows.opportunity_workspace_list_terms;
  const rpc = none.client.rpc;
  none.client.rpc = (name: string, ...rest: unknown[]) => (name === 'opportunity_workspace_list_terms'
    ? { then: (resolve: any) => resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } as any : rpc(name, ...rest as []));
  const before = await readWorkspaceOverview(none.client, admin, { view: 'all', categories: ['seguridad'] });
  assert.deepEqual(before.items.map((item: any) => item.id), ['a'], 'without the function the list is narrowed here');
  const plain = await readWorkspaceOverview(slowClient().client, admin, { view: 'all' });
  assert.deepEqual(plain.items.map((item: any) => item.id), ['a', 'b'], 'no category: the list as it always was');
});
