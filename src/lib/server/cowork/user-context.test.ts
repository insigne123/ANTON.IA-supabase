import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCoworkUserContext } from './user-context';

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
