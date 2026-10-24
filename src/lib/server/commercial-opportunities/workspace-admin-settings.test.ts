import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// saveAdminSettings with an in-memory client; the session and access modules are replaced (they need the Next.js runtime).
const entry = await build({
  stdin: { contents: `export { saveAdminSettings, adminSettingsInputSchema } from './src/lib/server/commercial-opportunities/workspace-admin-settings';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'isolated-settings', setup(builder) {
    builder.onResolve({ filter: /auth-utils$|\.\/workspace-access$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path.includes('auth-utils')
      ? 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}'
      : 'export async function assertOpportunityRead(){} export function assertOpportunityAdmin(scope){ if (!["admin","owner"].includes(scope.role)) { const e = new Error("Solo administradores"); e.status = 403; throw e; } } export async function readableOpportunityIds(){return null}' }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', entry.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { saveAdminSettings, adminSettingsInputSchema } = compiled.exports;

const ORG = 'org-1';
const ANA = '00000000-0000-4000-8000-0000000000a1', DIEGO = '00000000-0000-4000-8000-0000000000d1', GONE = '00000000-0000-4000-8000-0000000000e1';
/** The context row of the organization and its members; `written` keeps what the update wrote. */
function clientWith(context: Record<string, unknown> | null, members = [ANA, DIEGO]) {
  const written: unknown[] = [];
  const client = { from(table: string) {
    let update: unknown = null;
    const chain: any = {
      select: () => chain, eq: () => chain, in: () => chain,
      update: (values: unknown) => { update = values; return chain; },
      maybeSingle: async () => ({ data: context, error: null }),
      then: (resolve: (value: unknown) => void) => {
        if (update) { written.push(update); return resolve({ data: null, error: null }); }
        return resolve({ data: table === 'organization_members' ? members.map(user_id => ({ user_id })) : [], error: null });
      },
    };
    return chain;
  } };
  return { client, written };
}
const admin = { organizationId: ORG, userId: ANA, role: 'admin' };
const parse = (input: unknown) => adminSettingsInputSchema.parse(input);

test('the rules are saved whole, each one with its id, and only for people of the organization', async () => {
  const { client, written } = clientWith({ admin_settings: {} });
  const saved = await saveAdminSettings(client, admin, parse({ op: 'rules', rules: [{ category: 'seguridad', minAmount: null, userId: DIEGO }] }));
  assert.equal(saved.rules.length, 1);
  assert.match(saved.rules[0].id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(written, [{ admin_settings: saved }]);
  await assert.rejects(saveAdminSettings(clientWith({ admin_settings: {} }).client, admin, parse({ op: 'rules', rules: [{ category: null, minAmount: null, userId: GONE }] })), /ya no está en la organización/);
  await assert.rejects(saveAdminSettings(clientWith(null).client, admin, parse({ op: 'rules', rules: [] })), /Confirma primero la oferta/);
  await assert.rejects(saveAdminSettings(clientWith({ admin_settings: {} }).client, { ...admin, role: 'member' }, parse({ op: 'rules', rules: [] })), /Solo administradores/);
});

test('a search saved again is renamed, never kept twice; each person turns their own notice on and off', async () => {
  const search = { name: 'Guardias', filter: 'recommended', source: 'tender', query: 'guardias', categories: [] };
  const first = await saveAdminSettings(clientWith({ admin_settings: {} }).client, admin, parse({ op: 'search', search }));
  assert.deepEqual(first.searches.map((item: any) => [item.name, item.notify, item.createdBy]), [['Guardias', [ANA], ANA]]);
  const again = await saveAdminSettings(clientWith({ admin_settings: first }).client, { ...admin, userId: DIEGO }, parse({ op: 'search', search: { ...search, name: 'Guardias RM', query: 'GUARDIAS' } }));
  assert.deepEqual(again.searches.map((item: any) => [item.name, item.notify]), [['Guardias RM', [ANA, DIEGO]]]);
  const off = await saveAdminSettings(clientWith({ admin_settings: again }).client, admin, parse({ op: 'search_notify', id: again.searches[0].id, on: false }));
  assert.deepEqual(off.searches[0].notify, [DIEGO]);
  const removed = await saveAdminSettings(clientWith({ admin_settings: off }).client, admin, parse({ op: 'search_remove', id: off.searches[0].id }));
  assert.deepEqual(removed.searches, []);
  await assert.rejects(saveAdminSettings(clientWith({ admin_settings: removed }).client, admin, parse({ op: 'search_notify', id: 'missing', on: true })), /ya no está guardada/);
});
