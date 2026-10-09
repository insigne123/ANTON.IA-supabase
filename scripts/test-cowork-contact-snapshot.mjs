import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const id = '00000000-0000-4000-8000-000000000001';
const objects = new Map(); let queries = 0; let size = 25;
globalThis.__cwSnapshot = {
  getRun: async () => ({ run: { id }, events: [{ sequence: 1, kind: 'tool.completed', payload: { action: 'leads.search', input: 'ventas', result: {} } }] }),
  query: async () => { queries++; return { scope: 'own_saved_contacts', items: Array.from({ length: size }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12,'0')}`, name: `Persona ${i}` })), truncated: false }; },
  client: { storage: { from: () => ({ download: async key => ({ data: objects.has(key) ? { arrayBuffer: async () => objects.get(key) } : null, error: objects.has(key) ? null : { message: 'Object not found' } }),
    upload: async (key, bytes) => { if (objects.has(key)) return { error: { message: 'already exists' } }; objects.set(key, bytes); return { error: null }; } }) } },
};
const mocks = { './runs': 'export const getCoworkRun=(...args)=>globalThis.__cwSnapshot.getRun(...args);',
  './lead-tools': 'export const COWORK_FULL_LIST_MAX=500;export const queryCoworkLeads=(...args)=>globalThis.__cwSnapshot.query(...args);',
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>globalThis.__cwSnapshot.client;' };
const result = await build({ entryPoints: ['src/lib/server/cowork/contact-list.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated', setup(build) { build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] })); } }] });
const loaded = { exports: {} }; new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
try {
  const auth = { user: { id }, organizationId: id, supabase: {} };
  const first = await loaded.exports.loadCoworkFullContactList(auth,id,1);
  size = 45;
  const download = await loaded.exports.loadCoworkFullContactList(auth,id,1);
  assert.equal(first.result.items.length,25); assert.equal(download.result.items.length,25); assert.equal(queries,1);
  assert.deepEqual(download.result,first.result);
  console.log('PASS: expansion freezes the observed list; later export cannot silently refresh it. Isolated storage/API.');
} finally { delete globalThis.__cwSnapshot; }
