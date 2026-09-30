import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCoworkMemories, loadCoworkUserContext } from './user-context';

const userId = '00000000-0000-4000-8000-000000000001';
const scope = { userId, organizationId: '00000000-0000-4000-8000-000000000002' };

/** profiles answers with `profile`; antonia_workflow_settings with `settings`. */
function client(profile: unknown, settings: unknown = null, profileError: unknown = null) {
  const calls: Array<{ table: string; eq: unknown[] }> = [];
  return { calls, client: { from: (table: string) => {
    const chain = { select: () => chain, eq: (...args: unknown[]) => { calls.push({ table, eq: args }); return chain; },
      maybeSingle: async () => table === 'profiles' ? { data: profile, error: profileError } : { data: settings, error: null } };
    return chain;
  } } };
}

test('user context signs with the own profile and keeps email, signatures and tokens out', async () => {
  const { client: db, calls } = client({ id: userId, full_name: '  Nicolás   Y. ', job_title: 'Gerente Comercial', company_name: 'Yago SpA',
    company_domain: 'yago.cl', email: 'ventas@yago.cl', signatures: { gmail: { html: '<b>privada</b>' } }, token: 'secret' },
  { user_company_profile: { companyName: 'Yago SpA', products: [{ name: 'AXIS', summary: 'consultas judiciales automáticas' }] } });
  const context = await loadCoworkUserContext(db as never, scope);
  assert.deepEqual(context, { fullName: 'Nicolás Y.', jobTitle: 'Gerente Comercial', companyName: 'Yago SpA', companyDomain: 'yago.cl',
    offer: 'Yago SpA. Productos: AXIS: consultas judiciales automáticas', offerSource: 'organization' });
  assert.deepEqual(calls[0], { table: 'profiles', eq: ['id', userId] });
  assert.doesNotMatch(JSON.stringify(context), /ventas@|privada|secret/);
});

test('an offer in the own profile wins over the organization settings, as in app.context', async () => {
  const { client: db, calls } = client({ id: userId, full_name: 'Ana', value_proposition: 'Verificación de antecedentes en minutos' },
    { user_company_profile: 'Otra oferta' });
  const context = await loadCoworkUserContext(db as never, scope);
  assert.equal(context?.offer, 'Verificación de antecedentes en minutos');
  assert.equal(context?.offerSource, 'profile');
  assert.ok(!calls.some(call => call.table === 'antonia_workflow_settings'), 'no second read when the profile has an offer');
});

test('missing values stay null and failures fall back to the reads', async () => {
  const empty = await loadCoworkUserContext(client(null).client as never, scope);
  assert.deepEqual(empty, { fullName: null, jobTitle: null, companyName: null, companyDomain: null, offer: null, offerSource: null });
  assert.equal(await loadCoworkUserContext(client(null, null, { message: 'private' }).client as never, scope), null);
  assert.equal(await loadCoworkUserContext(client({ id: 'other-user', full_name: 'Otra persona' }).client as never, scope), null);
  assert.equal(await loadCoworkUserContext(client({ id: userId }).client as never, { ...scope, userId: 'not-a-uuid' }), null);
  const throwing = { from: () => { throw new Error('network'); } };
  assert.equal(await loadCoworkUserContext(throwing as never, scope), null);
});

/** A client whose suplia_memories answers with `rows` (as PostgREST would after the filters), and profiles with `profile`. */
function memoryClient(rows: unknown[], profile: unknown = { id: userId, full_name: 'Ana', value_proposition: 'Verificación de antecedentes' }) {
  const queries: Array<{ table: string; eq: unknown[][]; order: unknown[] | null; limit: number | null }> = [];
  return { queries, client: { from: (table: string) => {
    const query = { table, eq: [] as unknown[][], order: null as unknown[] | null, limit: null as number | null };
    queries.push(query);
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => { query.eq.push(args); return chain; },
      order: (...args: unknown[]) => { query.order = args; return chain; },
      limit: (value: number) => { query.limit = value; return chain; },
      maybeSingle: async () => ({ data: table === 'profiles' ? profile : null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve({ data: table === 'suplia_memories' ? rows : null, error: null }).then(resolve, reject),
    };
    return chain;
  } } };
}
const memory = (patch: Record<string, unknown>) => ({ scope: 'organization', user_id: null, memory_type: 'preference', key: 'tono', value: 'Tuteo', expires_at: null, ...patch });

test('approved memories: the organization\'s and your own, newest first, never a teammate\'s or an expired one', async () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const { client: db, queries } = memoryClient([
    memory({ key: 'tono', value: { text: 'Tuteo, cercano y breve' } }),
    memory({ scope: 'user', user_id: userId, memory_type: 'business', key: 'Clientes ideales', value: 'Empresas de outsourcing con más de 200 personas', expires_at: '2027-01-01T00:00:00Z' }),
    memory({ scope: 'user', user_id: '00000000-0000-4000-8000-0000000000cc', key: 'firma', value: 'Firma como Ana' }),
    memory({ key: 'promo', value: 'Descuento de septiembre', expires_at: '2026-09-01T00:00:00Z' }),
    memory({ key: 'tono', value: { text: 'Tuteo, cercano y breve' } }),
    memory({ key: '', memory_type: 'nota', value: { summary: `Evitar ${'x'.repeat(400)}` } }),
    memory({ key: 'Oferta', value: 'Oferta: AXIS en 48 horas' }),
  ]);
  const memories = await loadCoworkMemories(db as never, scope, now);
  assert.deepEqual(memories.slice(0, 2), ['tono: Tuteo, cercano y breve', 'Clientes ideales: Empresas de outsourcing con más de 200 personas']);
  assert.equal(memories.length, 4, 'no teammate memory, no expired one, no repeat');
  assert.ok(memories[2].startsWith('nota: Evitar') && memories[2].length === 240 && memories[2].endsWith('…'));
  assert.equal(memories[3], 'Oferta: AXIS en 48 horas', 'a value that already names its key is not labelled twice');
  assert.deepEqual(queries[0].eq, [['organization_id', scope.organizationId], ['status', 'approved']]);
  assert.deepEqual(queries[0].order, ['updated_at', { ascending: false }]);
  // At most eight.
  const many = await loadCoworkMemories(memoryClient(Array.from({ length: 12 }, (_, index) => memory({ key: `m${index}`, value: `valor ${index}` }))).client as never, scope, now);
  assert.equal(many.length, 8);
});

test('the user context carries memories only when there are some, and the home skips reading them', async () => {
  const withMemories = await loadCoworkUserContext(memoryClient([memory({ key: 'tono', value: 'Tuteo' })]).client as never, scope);
  assert.deepEqual(withMemories?.memories, ['tono: Tuteo']);
  const without = await loadCoworkUserContext(memoryClient([]).client as never, scope);
  assert.ok(without && !('memories' in without), 'a turn without memories reads exactly as before');
  const home = memoryClient([memory({})]);
  await loadCoworkUserContext(home.client as never, scope, { memories: false });
  assert.ok(!home.queries.some(query => query.table === 'suplia_memories'));
  // A failing read leaves them out; the rest of the context stays.
  const failing = { from: (table: string) => table === 'suplia_memories' ? { select: () => { throw new Error('network'); } } : memoryClient([]).client.from(table) };
  const context = await loadCoworkUserContext(failing as never, scope);
  assert.equal(context?.offer, 'Verificación de antecedentes');
  assert.ok(context && !('memories' in context));
});
