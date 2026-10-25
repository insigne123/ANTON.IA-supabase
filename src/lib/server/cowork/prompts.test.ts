import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «Pedidos guardados» (COW-06) with cowork_prompts in memory.
async function load(entry: string, stubs: Record<string, string>) {
  const bundle = await build({
    stdin: { contents: entry, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      const filter = new RegExp(`(${Object.keys(stubs).map(name => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
      builder.onResolve({ filter }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[Object.keys(stubs).find(name => args.path.endsWith(name))!] }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports;
}

const ME = '00000000-0000-4000-8000-000000000001';
const MATE = '00000000-0000-4000-8000-000000000002';
const ORG = '00000000-0000-4000-8000-000000000003';
const OTHER_ORG = '00000000-0000-4000-8000-000000000004';
const id = (n: number) => `00000000-0000-4000-8000-1000000000${String(n).padStart(2, '0')}`;

type Row = { id: string; organization_id: string; user_id: string; title: string; prompt: string; shared: boolean; updated_at: string };
const world: { rows: Row[]; missing: boolean; seq: number } = { rows: [], missing: false, seq: 50 };
(globalThis as any).__prompts = world;

// A small query builder: eq and or(user_id.eq.X,shared.eq.true) filter, insert/update/delete change the rows.
const admin = `export function getSupabaseAdminClient() {
  const w = globalThis.__prompts;
  return { from() {
    let mode = 'select'; let values = null; const filters = []; let limit = Infinity; let single = false;
    const run = () => {
      if (w.missing) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.cowork_prompts'" } };
      const match = row => filters.every(test => test(row));
      if (mode === 'insert') { const row = { id: '00000000-0000-4000-8000-2000000000' + (w.seq++), ...values }; w.rows.push(row); return { data: row, error: null }; }
      if (mode === 'update') { const rows = w.rows.filter(match); rows.forEach(row => Object.assign(row, values)); return { data: single ? rows[0] || null : rows, error: null }; }
      if (mode === 'delete') { w.rows = w.rows.filter(row => !match(row)); return { data: null, error: null }; }
      const rows = w.rows.filter(match).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit);
      return { data: single ? rows[0] || null : rows, error: null };
    };
    const chain = {
      select: () => chain, order: () => chain,
      insert: input => { mode = 'insert'; values = input; return chain; },
      update: input => { mode = 'update'; values = input; return chain; },
      delete: () => { mode = 'delete'; return chain; },
      eq: (column, value) => { filters.push(row => row[column] === value); return chain; },
      or: expression => { const [, user] = /user_id\\.eq\\.([^,]+)/.exec(expression); filters.push(row => row.user_id === user || row.shared === true); return chain; },
      limit: count => { limit = count; return chain; },
      single: async () => { single = true; return run(); },
      maybeSingle: async () => { single = true; return run(); },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  } };
}`;
const loaded = load(`export * from './src/lib/server/cowork/prompts';`, { '/supabase-admin': admin });

const member = { user: { id: ME }, organizationId: ORG, organizationRole: 'member' } as any;
const owner = { user: { id: ME }, organizationId: ORG, organizationRole: 'owner' } as any;
const row = (n: number, over: Partial<Row>): Row => ({
  id: id(n), organization_id: ORG, user_id: ME, title: `Pedido ${n}`, prompt: `Pedido número ${n} para Cowork`, shared: false, updated_at: `2026-10-2${n % 10}T10:00:00Z`, ...over,
});
function reset(rows: Row[] = [], missing = false) { world.rows = rows; world.missing = missing; world.seq = 50; }

test('the list has one’s own first, then what the team shared, and never another person’s private one or another organization’s', async () => {
  const { listCoworkPrompts } = await loaded;
  reset([
    row(1, { user_id: MATE, shared: true, updated_at: '2026-10-25T09:00:00Z' }),
    row(2, { updated_at: '2026-10-24T09:00:00Z' }),
    row(3, { user_id: MATE, shared: false }),
    row(4, { organization_id: OTHER_ORG, shared: true }),
  ]);
  const { available, prompts } = await listCoworkPrompts(member);
  assert.equal(available, true);
  assert.deepEqual(prompts.map((prompt: any) => [prompt.id, prompt.mine, prompt.canDelete]), [[id(2), true, true], [id(1), false, false]]);
  // An owner or admin can delete what the team shared.
  assert.equal((await listCoworkPrompts(owner)).prompts.find((prompt: any) => prompt.id === id(1)).canDelete, true);
});

test('before the migration the list is empty and saving says it is not available yet', async () => {
  const { listCoworkPrompts, saveCoworkPrompt, CoworkPromptRefused } = await loaded;
  reset([], true);
  assert.deepEqual(await listCoworkPrompts(member), { available: false, prompts: [] });
  await assert.rejects(saveCoworkPrompt(member, { prompt: 'Prepara un correo para mis contactos de retail' }),
    (error: any) => error instanceof CoworkPromptRefused && error.status === 503);
});

test('saving names it by its first words, keeps the same request once and changes only its name or sharing', async () => {
  const { saveCoworkPrompt } = await loaded;
  reset();
  const prompt = 'Busca 10 gerentes de personas en empresas de seguridad privada de Santiago con más de 200 trabajadores y prepara un correo';
  const first = await saveCoworkPrompt(member, { prompt: `  ${prompt}  ` });
  assert.equal(first.created, true);
  assert.equal(first.prompt.title, 'Busca 10 gerentes de personas en empresas de seguridad…');
  assert.equal(world.rows[0].prompt, prompt);
  const again = await saveCoworkPrompt(member, { prompt, shared: true, title: 'Seguridad privada' });
  assert.equal(again.created, false);
  assert.equal(world.rows.length, 1);
  assert.deepEqual([world.rows[0].title, world.rows[0].shared], ['Seguridad privada', true]);
});

test('at most 30 of one’s own; a request that is too short is refused before anything is written', async () => {
  const { saveCoworkPrompt, CoworkPromptRefused } = await loaded;
  reset(Array.from({ length: 30 }, (_, n) => row(n, { id: `00000000-0000-4000-8000-3000000000${String(n).padStart(2, '0')}` })));
  await assert.rejects(saveCoworkPrompt(member, { prompt: 'Un pedido nuevo que no cabe' }),
    (error: any) => error instanceof CoworkPromptRefused && error.status === 409 && /Borra uno/.test(error.message));
  reset();
  await assert.rejects(saveCoworkPrompt(member, { prompt: 'no' }));
  await assert.rejects(saveCoworkPrompt(member, { prompt: 'Un pedido válido', user_id: MATE } as any), 'only the fields it knows');
  assert.equal(world.rows.length, 0);
});

test('its author deletes one; a shared one, also an owner or admin; a teammate’s private one does not exist for you', async () => {
  const { deleteCoworkPrompt, CoworkPromptRefused } = await loaded;
  const refused = (status: number) => (error: any) => error instanceof CoworkPromptRefused && error.status === status;
  reset([row(1, {}), row(2, { user_id: MATE, shared: true }), row(3, { user_id: MATE, shared: false }), row(4, { organization_id: OTHER_ORG })]);
  await assert.rejects(deleteCoworkPrompt(member, id(2)), refused(403));
  await assert.rejects(deleteCoworkPrompt(owner, id(3)), refused(404));
  await assert.rejects(deleteCoworkPrompt(owner, id(4)), refused(404));
  assert.deepEqual(await deleteCoworkPrompt(member, id(1)), { deleted: true });
  assert.deepEqual(await deleteCoworkPrompt(owner, id(2)), { deleted: true });
  assert.deepEqual(world.rows.map(saved => saved.id), [id(3), id(4)]);
});
