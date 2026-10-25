import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «Editar criterios» in the search card (COW-29), with the run, the proposal and the events in memory.
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

const USER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const RUN = '00000000-0000-4000-8000-000000000003';

type World = { run: any; proposal: any; approvedMeanwhile: boolean; updates: any[]; events: any[] };
const world: World = { run: null, proposal: null, approvedMeanwhile: false, updates: [], events: [] };
(globalThis as any).__search = world;

const loaded = load(`export * from './src/lib/server/cowork/search-edit';`, {
  '/supabase-admin': `export function getSupabaseAdminClient() { const w = globalThis.__search; return { from(table) {
    let mode = 'select'; let values = null; const filters = {};
    const chain = {
      select: () => chain, eq: (column, value) => { filters[column] = value; return chain; },
      update: input => { mode = 'update'; values = input; return chain; },
      insert: async input => { w.events.push(input); return { error: null }; },
      maybeSingle: async () => {
        if (table === 'cowork_runs') return { data: w.run, error: null };
        if (mode === 'update') {
          // An approval that came first leaves the row out of «status = pending».
          if (w.approvedMeanwhile || w.proposal?.status !== filters.status) return { data: null, error: null };
          w.updates.push({ values, filters: { ...filters } }); w.proposal = { ...w.proposal, ...values };
          return { data: { run_id: filters.run_id }, error: null };
        }
        return { data: w.proposal, error: null };
      },
    };
    return chain;
  } } }`,
  './access': `export async function requireCoworkWorkerAccess() {}`,
});

const auth = { user: { id: USER }, organizationId: ORG } as any;
const people = { target: 'people', titles: ['Gerente de Personas'], industries: ['Retail'], locations: ['Santiago, Chile'], limit: 25 };
function reset(over: Partial<World> = {}) {
  Object.assign(world, { run: { id: RUN, status: 'waiting_approval' }, proposal: { criteria: people, status: 'pending' }, approvedMeanwhile: false, updates: [], events: [], ...over });
}

test('the edit replaces cargos, sectores, place and how many, and the approval runs what the card shows', async () => {
  const { editCoworkSearchProposal } = await loaded;
  reset();
  const result = await editCoworkSearchProposal(auth, RUN, { titles: ['Jefe de Selección', 'Gerente de Personas'], locations: ['Antofagasta, Chile'], limit: 10 });
  assert.equal(result.changed, true);
  assert.deepEqual(world.proposal.criteria, { target: 'people', titles: ['Jefe de Selección', 'Gerente de Personas'], industries: ['Retail'], locations: ['Antofagasta, Chile'], limit: 10 });
  assert.equal(world.updates[0].filters.status, 'pending', 'only while it waits');
  assert.deepEqual(world.events.map(event => [event.kind, event.payload.kind, event.payload.criteria.limit]), [['proposal.edited', 'search', 10]]);
});

test('the same criteria are no change; «Traer más» starts over from the first page when the search changes', async () => {
  const { editCoworkSearchProposal } = await loaded;
  reset();
  assert.equal((await editCoworkSearchProposal(auth, RUN, { titles: ['Gerente de Personas'], limit: 25 })).changed, false);
  assert.equal(world.updates.length + world.events.length, 0);
  reset({ proposal: { criteria: { ...people, page: 3 }, status: 'pending' } });
  await editCoworkSearchProposal(auth, RUN, { limit: 50 });
  assert.equal('page' in world.proposal.criteria, false);
});

test('nothing changes when the search was decided, an approval came first, or it is one exact profile', async () => {
  const { editCoworkSearchProposal, CoworkSearchEditRefused } = await loaded;
  const refused = async (status: number, over: Partial<World>, input: any = { limit: 10 }) => {
    reset(over);
    await assert.rejects(editCoworkSearchProposal(auth, RUN, input), (error: any) => error instanceof CoworkSearchEditRefused && error.status === status);
    assert.equal(world.events.length, 0);
  };
  await refused(409, { run: { id: RUN, status: 'completed' } });
  await refused(409, { proposal: { criteria: people, status: 'approved' } });
  await refused(409, { approvedMeanwhile: true });
  await refused(404, { run: null });
  await refused(409, { proposal: { criteria: { titles: [], industries: [], locations: [], linkedinUrl: 'https://www.linkedin.com/in/andrea-soto', limit: 1 }, status: 'pending' } });
});

test('the card says what to fill when an edit leaves the search without what it needs', async () => {
  const { coworkEditedSearchCriteria, CoworkSearchEditRefused } = await loaded;
  const message = (current: unknown, input: any) => {
    try { coworkEditedSearchCriteria(current, input); return 'ok'; } catch (error: any) { return error instanceof CoworkSearchEditRefused ? `${error.status} ${error.message}` : 'other'; }
  };
  assert.equal(message(people, { titles: [], industries: [], locations: [] }), '400 Deja al menos un cargo, un sector o una ubicación.');
  assert.equal(message({ ...people, strategy: 'companies_first' }, { titles: [] }), '400 Para buscar personas dentro de esas empresas, deja al menos un cargo.');
  assert.equal(message({ ...people, strategy: 'companies_first' }, { industries: [] }), '400 Para buscar empresas primero, deja al menos un sector.');
  assert.throws(() => coworkEditedSearchCriteria(people, { limit: 101 }));
  assert.throws(() => coworkEditedSearchCriteria(people, { page: 2 } as any), 'only the four fields of the card');
  // A packed title is split as when Cowork proposes it.
  assert.deepEqual(coworkEditedSearchCriteria(people, { titles: ['Gerente de Personas / People Manager'] }).titles, ['Gerente de Personas', 'People Manager']);
});
