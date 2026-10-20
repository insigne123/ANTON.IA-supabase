import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichExtensionBatch, lookupErrorMessage } from './extension-enrich-batch';

const auth = { supabase: {}, organizationId: 'org', user: { id: 'me' } } as any;
const profile = (handle: string) => ({ linkedinUrl: `https://www.linkedin.com/in/${handle}`, fullName: handle, title: 'Gerente', companyName: 'Acme',
  email: '', companyDomain: '', primaryPhone: '', emailStatus: 'unknown' });
const rows: Record<string, any> = {
  ana: { id: 'lead-ana', user_id: 'me', full_name: 'Ana Pérez', linkedin_url: 'https://www.linkedin.com/in/ana', company_name: 'Acme', title: 'Gerente' },
  bruno: { id: 'lead-bruno', user_id: 'me', full_name: 'Bruno', linkedin_url: 'https://www.linkedin.com/in/bruno', email: 'bruno@acme.cl' },
  carla: { id: 'lead-carla', user_id: 'teammate', full_name: 'Carla', linkedin_url: 'https://www.linkedin.com/in/carla' },
  eva: { id: 'lead-eva', user_id: 'me', full_name: 'Eva', linkedin_url: 'https://www.linkedin.com/in/eva' },
  fede: { id: 'lead-fede', user_id: 'me', full_name: 'Fede', linkedin_url: 'https://www.linkedin.com/in/fede' },
};
const handle = (url: string) => url.split('/in/')[1];

test('saves the chosen people and looks up only the emails that are missing, of this person\'s contacts, in the order chosen', async () => {
  const lookedUp: any[] = [];
  const result = await enrichExtensionBatch(auth, { profiles: ['fede', 'ana', 'bruno', 'carla', 'diego', 'eva'].map(profile), revealPhone: false }, {
    saveBatch: (async () => ({
      saved: [{ linkedinUrl: profile('ana').linkedinUrl, fullName: 'ana' }, { linkedinUrl: profile('eva').linkedinUrl, fullName: 'eva' }, { linkedinUrl: profile('fede').linkedinUrl, fullName: 'fede' }],
      already: [{ linkedinUrl: profile('bruno').linkedinUrl, fullName: 'bruno' }, { linkedinUrl: profile('carla').linkedinUrl, fullName: 'carla' }],
      blocked: [{ linkedinUrl: profile('diego').linkedinUrl, fullName: 'diego', reason: 'En conversación con Ana' }],
      failed: [],
    })) as any,
    findLead: (async (_auth: unknown, p: any) => rows[handle(p.linkedinUrl)] || null) as any,
    lookUp: async (leads, revealPhone) => {
      lookedUp.push(...leads);
      assert.equal(revealPhone, false);
      return { consumed: 2, enriched: [
        { id: 'lead-ana', email: 'ana@acme.cl', enrichmentStatus: 'completed' },
        { id: 'lead-eva', enrichmentStatus: 'not_found' },
        { id: 'lead-fede', enrichmentStatus: 'pending_phone' },
      ] };
    },
  });
  assert.deepEqual(lookedUp.map(lead => lead.id), ['lead-ana', 'lead-eva', 'lead-fede'], 'not Bruno (had an email) nor Carla (a teammate\'s)');
  assert.deepEqual(result.people.map(person => [person.fullName, person.outcome]), [
    ['Fede', 'pending'], ['Ana Pérez', 'email'], ['bruno', 'had_email'], ['carla', 'teammate'], ['diego', 'blocked'], ['Eva', 'not_found'],
  ]);
  assert.equal(result.people[1].email, 'ana@acme.cl');
  assert.equal(result.consumed, 2);
  assert.equal(result.warning, undefined);
});

test('when the lookup cannot run they stay saved and the reason is said once', async () => {
  const result = await enrichExtensionBatch(auth, { profiles: [profile('ana')], revealPhone: true }, {
    saveBatch: (async () => ({ saved: [{ linkedinUrl: profile('ana').linkedinUrl, fullName: 'ana' }], already: [], blocked: [], failed: [] })) as any,
    findLead: (async () => rows.ana) as any,
    lookUp: async () => ({ enriched: [], consumed: 0, error: lookupErrorMessage({ error: 'DAILY_QUOTA_EXCEEDED' }) }),
  });
  assert.equal(result.people[0].outcome, 'failed');
  assert.match(result.warning || '', /créditos de hoy/);
  assert.match(lookupErrorMessage({ error: 'X', message: 'Esta cuenta no tiene créditos disponibles para enriquecimiento.' }), /no tiene créditos/);
  assert.match(lookupErrorMessage({ error: 'APOLLO_PROVIDER_NOT_CONFIGURED' }), /no está disponible/);
});
