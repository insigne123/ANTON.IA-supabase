import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// workspaceMembers with an in-memory client; the session and access modules are replaced (they need the Next.js runtime).
const entry = await build({
  stdin: { contents: `export { workspaceMembers } from './src/lib/server/commercial-opportunities/workspace-store';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'isolated-members', setup(builder) {
    builder.onResolve({ filter: /auth-utils$|\.\/workspace-access$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path.includes('auth-utils')
      ? 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}'
      : 'export async function assertOpportunityRead(){} export async function assertOpportunityAdmin(){} export async function readableOpportunityIds(){return null}' }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', entry.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { workspaceMembers } = compiled.exports;

type Row = Record<string, unknown>;

/** The two reads of the member list: `organization_members` of the organization and the `profiles` of those users. */
function clientWith(members: Row[], profiles: Row[]) {
  const selected: string[] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          selected.push(`${table}:${columns}`);
          const rows = table === 'organization_members' ? members : profiles;
          const done = { data: rows, error: null };
          return { eq: () => ({ limit: async () => done }), in: async () => done };
        },
      };
    },
  };
  return { client, selected };
}

const scope = { organizationId: 'org', userId: 'admin', role: 'owner' };

test('the team list shows the name, then the email of whoever has no name yet, and only then «Integrante»', async () => {
  const { client, selected } = clientWith(
    [{ user_id: 'a', role: 'owner' }, { user_id: 'b', role: 'member' }, { user_id: 'c', role: 'member' }, { user_id: 'd', role: 'member' }],
    [
      { id: 'a', full_name: 'Camila Torres', email: 'camila@yago-qa.cl' },
      { id: 'b', full_name: null, email: 'vespinoza@grupoexpro.com' },
      { id: 'c', full_name: '   ', email: ' lgordo@grupoexpro.com ' },
      { id: 'd', full_name: null, email: null },
    ],
  );
  const members = await workspaceMembers(client, scope);
  assert.deepEqual(members.map((member: { name: string }) => member.name), ['Camila Torres', 'vespinoza@grupoexpro.com', 'lgordo@grupoexpro.com', 'Integrante']);
  assert.deepEqual(members.map((member: { role: string }) => member.role), ['owner', 'member', 'member', 'member']);
  assert.ok(selected.includes('profiles:id,full_name,email'));
});

test('a member whose profile row is missing is still listed', async () => {
  const { client } = clientWith([{ user_id: 'z', role: 'member' }], []);
  assert.deepEqual(await workspaceMembers(client, scope), [{ user_id: 'z', role: 'member', name: 'Integrante' }]);
});

test('for «Asignar», each person comes with how many opportunities in play they work; what is submitted or closed does not weigh', async () => {
  const tables: Record<string, Row[]> = {
    organization_members: [{ user_id: 'diego', role: 'member' }, { user_id: 'maria', role: 'member' }],
    profiles: [{ id: 'diego', full_name: 'Diego Soto' }, { id: 'maria', full_name: 'María Paz' }],
    opportunity_work: [{ opportunity_id: 'o1' }, { opportunity_id: 'o2' }],
    opportunity_participants: [{ opportunity_id: 'o1', user_id: 'diego' }, { opportunity_id: 'o2', user_id: 'diego' }, { opportunity_id: 'o3', user_id: 'maria' }],
  };
  const states: unknown[] = [];
  const client = { from: (table: string) => ({ select: () => {
    const done = { data: tables[table], error: null };
    const chain: any = { eq: () => chain, in: (column: string, values: unknown[]) => { if (column === 'state') states.push(values); return chain; }, limit: async () => done, then: (resolve: (value: unknown) => void) => resolve(done) };
    return chain;
  } }) };
  const members = await workspaceMembers(client, scope, { load: true });
  assert.deepEqual(members.map((member: { name: string; open?: number }) => [member.name, member.open]), [['Diego Soto', 2], ['María Paz', 0]]);
  assert.deepEqual(states, [['assigned', 'working', 'blocked']]);
});
