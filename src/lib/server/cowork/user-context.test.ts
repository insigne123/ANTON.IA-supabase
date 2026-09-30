import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileUpdate, createEmptyProfileForm } from '@/lib/profile/profile-mappings';
import { coworkUserContextFromProfile, loadCoworkUserContext } from './user-context';

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
