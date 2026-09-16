import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const auth = { user: { id: 'owner' }, organizationId: 'org' };
let rows = {};
const calls = [];
globalThis.__coworkThreadLookup = async (caller, id) => {
  assert.equal(caller, auth);
  calls.push(id);
  return rows[id] || null;
};
const bundle = await build({ entryPoints: ['src/lib/server/cowork/thread.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'scope-fixture', setup(build) {
    build.onResolve({ filter: /^\.\/runs$/ }, () => ({ path: 'runs', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const getCoworkRun=(auth,id)=>globalThis.__coworkThreadLookup(auth,id);' }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const get = id => module.exports.getCoworkThread(auth, id);
const row = (id, parent) => ({ run: { id, parent_run_id: parent }, events: [] });
try {
  rows = { a: row('a', null), b: row('b', 'a'), c: row('c', 'b') };
  assert.deepEqual((await get('c')).ancestors.map(turn => turn.run.id), ['a', 'b']);
  assert.equal((await get('c')).olderTurnsOmitted, false);
  assert.equal(await get('missing'), null);
  delete rows.a;
  await assert.rejects(get('c'), /unavailable/);
  rows = { a: row('a', 'a') };
  await assert.rejects(get('a'), /ancestry/);
  rows = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i), row(String(i), i ? String(i - 1) : null)]));
  const bounded = await get('11');
  assert.equal(bounded.ancestors.length, 8);
  assert.equal(bounded.olderTurnsOmitted, true);
  console.log('PASS: scoped ancestry, chronological order, missing/foreign parent, cycles and bounded history.');
} finally { delete globalThis.__coworkThreadLookup; }
