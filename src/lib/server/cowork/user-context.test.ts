import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileUpdate, createEmptyProfileForm } from '@/lib/profile/profile-mappings';
import { coworkUserContextFromProfile, loadCoworkMemories, loadCoworkUserContext } from './user-context';

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

/** A profiles row exactly as the «Perfil» page saves it, next to an email signature. */
function perfilRow(fields: Partial<ReturnType<typeof createEmptyProfileForm>>) {
  const update = buildProfileUpdate({ ...createEmptyProfileForm(), name: 'Nicolás Y.', role: 'Gerente Comercial', companyName: 'Yago SpA',
    website: 'yago.cl', ...fields }, { signatures: { gmail: { enabled: true, html: '<p>Nicolás · +56 9 1234 5678</p>' } } });
  return { id: userId, email: 'ventas@yago.cl', ...update };
}

test('the offer saved in «Perfil» reaches Cowork, with its services, proof points and sector', async () => {
  const row = perfilRow({ sector: 'Software B2B', description: 'Desarrollamos AXIS para empresas que contratan mucho personal.',
    services: 'AXIS: consultas judiciales en el PJUD, Carga por archivo o por correo',
    valueProposition: 'AXIS consulta en el PJUD por persona o por lote y entrega evidencia auditable.',
    proofPoints: 'Procesa 1.000 personas en unos 30 minutos.\nSin costo de implementación.' });
  const { client: db, calls } = client(row, { user_company_profile: 'Otra oferta' });
  const context = await loadCoworkUserContext(db as never, scope);
  assert.deepEqual(context, {
    fullName: 'Nicolás Y.', jobTitle: 'Gerente Comercial', companyName: 'Yago SpA', companyDomain: 'yago.cl',
    offer: 'AXIS consulta en el PJUD por persona o por lote y entrega evidencia auditable. Desarrollamos AXIS para empresas que contratan mucho personal. Productos y servicios: AXIS: consultas judiciales en el PJUD; Carga por archivo o por correo.',
    offerSource: 'profile',
    services: ['AXIS: consultas judiciales en el PJUD', 'Carga por archivo o por correo'],
    proofPoints: ['Procesa 1.000 personas en unos 30 minutos.', 'Sin costo de implementación.'],
    sector: 'Software B2B',
  });
  assert.ok(!calls.some(call => call.table === 'antonia_workflow_settings'), 'no second read when «Perfil» has an offer');
  assert.doesNotMatch(JSON.stringify(context), /ventas@|\+56|<p>/, 'no email or signature reaches the model');
});

test('services alone are an offer; a company name is not', () => {
  assert.equal(coworkUserContextFromProfile(perfilRow({ services: 'AXIS, SADT' })).offer, 'Productos y servicios: AXIS; SADT.');
  const onlyName = coworkUserContextFromProfile(perfilRow({ sector: 'Software' }));
  assert.equal(onlyName.offer, null);
  assert.equal(onlyName.offerSource, null);
  assert.equal(onlyName.sector, 'Software');
  assert.equal(coworkUserContextFromProfile({ id: userId, company_name: 'Yago SpA', companyName: 'Yago SpA' }).offer, null);
});

test('long «Perfil» fields never break the context: they are clipped', () => {
  const long = 'palabra '.repeat(700);
  const context = coworkUserContextFromProfile(perfilRow({ description: long, valueProposition: long, services: long, proofPoints: long,
    companyName: 'Y'.repeat(400), role: 'R'.repeat(3000) }));
  assert.ok(context.offer && context.offer.length <= 600, 'offer up to 600 characters');
  assert.equal(context.offerSource, 'profile');
  assert.ok((context.services || []).every(service => service.length <= 120));
  assert.ok((context.proofPoints || []).every(point => point.length <= 200));
  assert.equal(context.companyName?.length, 120);
});

test('an older top-level offer field still counts when «Perfil» is empty', async () => {
  const { client: db } = client({ id: userId, full_name: 'Ana', value_proposition: 'Verificación de antecedentes en minutos' },
    { user_company_profile: 'Otra oferta' });
  const context = await loadCoworkUserContext(db as never, scope);
  assert.equal(context?.offer, 'Verificación de antecedentes en minutos');
  assert.equal(context?.offerSource, 'profile');
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
  const queries: Array<{ table: string; eq: unknown[][]; or: string | null; order: unknown[] | null; limit: number | null }> = [];
  return { queries, client: { from: (table: string) => {
    const query = { table, eq: [] as unknown[][], or: null as string | null, order: null as unknown[] | null, limit: null as number | null };
    queries.push(query);
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => { query.eq.push(args); return chain; },
      or: (value: string) => { query.or = value; return chain; },
      order: (...args: unknown[]) => { query.order = args; return chain; },
      limit: (value: number) => { query.limit = value; return chain; },
      maybeSingle: async () => ({ data: table === 'profiles' ? profile : null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        const visible = table === 'suplia_memories' ? rows.filter(row => !query.or || (row as { scope?: string; user_id?: string }).scope === 'organization'
          || (row as { user_id?: string }).user_id === userId).slice(0, query.limit ?? rows.length) : null;
        return Promise.resolve({ data: visible, error: null }).then(resolve, reject);
      },
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
  assert.equal(queries[0].or, `scope.eq.organization,user_id.eq.${userId}`);
  assert.deepEqual(queries[0].order, ['updated_at', { ascending: false }]);
  // At most eight.
  const many = await loadCoworkMemories(memoryClient(Array.from({ length: 12 }, (_, index) => memory({ key: `m${index}`, value: `valor ${index}` }))).client as never, scope, now);
  assert.equal(many.length, 8);
  const crowded = memoryClient([
    ...Array.from({ length: 24 }, (_, index) => memory({ scope: 'user', user_id: '00000000-0000-4000-8000-0000000000cc', key: `otro${index}` })),
    memory({ scope: 'user', user_id: userId, key: 'Preferencia propia', value: 'Tuteo' }),
  ]);
  assert.deepEqual(await loadCoworkMemories(crowded.client as never, scope, now), ['Preferencia propia: Tuteo']);
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
