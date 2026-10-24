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
  opportunity_workspace_page: [{ id: 'op1', title: 'Servicio de traslado' }],
  opportunity_workspace_counts: [{ stage: 'open', evaluation: 'recommended', total: 3 }, { stage: 'open', evaluation: 'pending', total: 2 }, { stage: 'assigned', evaluation: 'review', total: 1 }, { stage: 'lost', evaluation: null, total: '4' }],
  opportunity_work: [{ opportunity_id: 'op1', status: 'working' }],
  opportunity_notifications: [{ id: 'n1', opportunity_id: 'op1', title: 'Informe listo', created_at: '2026-10-15T21:42:00Z', read_at: null }],
  organization_reporting_groups: [{ id: 'g1', name: 'Licitaciones' }],
  opportunity_company_context: { offer: 'Logística' },
  opportunity_budget_months: { spent_micro_usd: 2_140_000, reserved_micro_usd: 0 },
  organization_members: [{ user_id: 'u1', role: 'admin' }],
  profiles: [{ id: 'u1', full_name: 'Pruebas ANTON.IA' }],
};
function slowClient() {
  const state = { inFlight: 0, most: 0, order: [] as string[], calls: [] as Array<[string, any]> };
  const answer = (name: string) => {
    state.inFlight++; state.most = Math.max(state.most, state.inFlight); state.order.push(name);
    return new Promise(resolve => setTimeout(() => { state.inFlight--; resolve({ data: rows[name] ?? null, error: null }); }, 30));
  };
  const chain = (name: string): any => new Proxy({}, { get: (_target, key) => key === 'then'
    ? (resolve: any, reject: any) => answer(name).then(resolve, reject)
    : key === 'single' || key === 'maybeSingle' ? () => answer(name) : () => chain(name) });
  return { state, client: { from: (table: string) => chain(table), rpc: (name: string, args?: unknown) => { state.calls.push([name, args]); return chain(name); } } };
}

test('the overview reads its parts together and still answers the same', async () => {
  const { state, client } = slowClient();
  const overview = await readWorkspaceOverview(client, { organizationId: 'org', userId: 'u1', role: 'admin' }, { view: 'recommended' });
  // The list, notifications, teams, offer, budget and members at once; the work records after the list.
  assert.ok(state.most >= 6, `at most ${state.most} reads at once`);
  assert.equal(state.order.at(-1), 'opportunity_work');
  assert.deepEqual({ ...overview, sourceStatus: undefined }, {
    mode: 'management', items: rows.opportunity_workspace_page, work: rows.opportunity_work, notifications: rows.opportunity_notifications,
    members: [{ user_id: 'u1', role: 'admin', name: 'Pruebas ANTON.IA' }], groups: rows.organization_reporting_groups, context: rows.opportunity_company_context,
    budget: { spent: 2.14, reserved: 0, cap: 20 }, sourceStatus: undefined, documentAlerts: [], searching: [],
    // The numbers of the filters, from the stages and evaluations of the database.
    counts: { recommended: 3, review: 2, excluded: 0, assigned: 1, working: 0, submitted: 0, closed: 4 },
  });
});

test('someone who is not an admin gets the assigned view without the admin reads', async () => {
  const { state, client } = slowClient();
  const overview = await readWorkspaceOverview(client, { organizationId: 'org', userId: 'u1', role: 'member' }, {});
  assert.equal(overview.mode, 'assigned');
  assert.deepEqual([overview.members, overview.groups, overview.context], [[], [], null]);
  assert.deepEqual(state.order.filter(name => /reporting_groups|company_context|budget|members|profiles/.test(name)), []);
});

test('the view, the words, the sources and the lines of service go to the database in one read, with the same filters for the counts', async () => {
  const { state, client } = slowClient();
  const admin = { organizationId: 'org', userId: 'u1', role: 'admin' };
  await readWorkspaceOverview(client, admin, { view: 'review', query: ' guardias ', kinds: ['tender', 'compra_agil'], categories: ['seguridad'], sort: 'deadline', page: 2 });
  const page = state.calls.find(([name]) => name === 'opportunity_workspace_page')![1];
  assert.deepEqual([page.p_stages, page.p_evaluations, page.p_biddable], [['open'], ['review', 'pending'], true], '«Por revisar» is what nobody works yet and can still be bid');
  assert.deepEqual([page.p_query, page.p_kinds, page.p_sort, page.p_limit, page.p_offset], ['guardias', ['tender', 'compra_agil'], 'deadline', 100, 200]);
  assert.ok(page.p_terms.length > 0, 'the line of service becomes its words');
  const counts = state.calls.find(([name]) => name === 'opportunity_workspace_counts')![1];
  assert.deepEqual([counts.p_query, counts.p_kinds, counts.p_terms, counts.p_biddable], ['guardias', ['tender', 'compra_agil'], page.p_terms, true]);
  assert.ok(!state.calls.some(([name]) => /opportunity_workspace_list/.test(name)), 'the old lists are not called');
  const assigned = slowClient();
  await readWorkspaceOverview(assigned.client, admin, { view: 'working' });
  assert.deepEqual(assigned.state.calls.find(([name]) => name === 'opportunity_workspace_page')![1].p_stages, ['working', 'blocked'], '«En preparación» holds the blocked ones too');
});

test('a member\'s filters are their own stages and their numbers; a count that fails leaves the list as it is', async () => {
  const member = slowClient();
  rows.opportunity_workspace_counts = [{ stage: 'assigned', evaluation: 'review', total: 2 }, { stage: 'working', evaluation: 'recommended', total: 1 }, { stage: 'won', evaluation: 'review', total: 1 }];
  const overview = await readWorkspaceOverview(member.client, { organizationId: 'org', userId: 'u1', role: 'member' }, { view: 'blocked' });
  assert.deepEqual(member.state.calls.find(([name]) => name === 'opportunity_workspace_page')![1].p_stages, ['blocked']);
  assert.deepEqual(overview.counts, { all: 3, assigned: 2, working: 1, blocked: 0, done: 1 });
  const failing = slowClient();
  const rpc = failing.client.rpc;
  failing.client.rpc = (name: string, args?: unknown) => (name === 'opportunity_workspace_counts'
    ? { then: (resolve: any) => resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } as any : rpc(name, args));
  const without = await readWorkspaceOverview(failing.client, { organizationId: 'org', userId: 'u1', role: 'admin' }, { view: 'all' });
  assert.equal(without.counts, undefined);
  assert.deepEqual(without.items, rows.opportunity_workspace_page);
});
