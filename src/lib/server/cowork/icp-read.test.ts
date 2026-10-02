import test from 'node:test';
import assert from 'node:assert/strict';
import { icpDeclaredFromProfile, readCoworkIcp } from './icp-read';

const USER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';

function fakeClient(tables: Record<string, unknown[]>, profile: unknown) {
  return { from(table: string) {
    if (table === 'profiles') {
      const chain = { select() { return chain; }, eq(column: string, value: string) { assert.equal(column, 'id'); assert.equal(value, USER); return chain; },
        async maybeSingle() { return { data: profile, error: null }; } };
      return chain;
    }
    const chain = {
      select() { return chain; },
      eq(column: string, value: string) { assert.equal(column, 'organization_id'); assert.equal(value, ORG); return chain; },
      order() { return chain; },
      async range(start: number, end: number) { return { data: (tables[table] || []).slice(start, end + 1), error: null }; },
    };
    return chain;
  } };
}

test('the declared customer comes from «Perfil»; a profile without one is null', () => {
  assert.equal(icpDeclaredFromProfile({ company_name: 'Acme', signatures: {} }), null);
  const declared = icpDeclaredFromProfile({ signatures: { profile_extended: {
    targetRoles: ['Gerente de Personas', 'Jefe de RR. HH.'], targetIndustries: ['Retail'], targetCompanySize: '201-500' } } });
  assert.deepEqual(declared?.roles, ['Gerente de Personas', 'Jefe de RR. HH.']);
  assert.deepEqual(declared?.industries, ['Retail']);
  assert.equal(declared?.companySize, '201-500');
});

test('icp.analyze reads the organization, returns the offer asked about and keeps the arithmetic', async () => {
  const client = fakeClient({
    contacted_leads: [{ id: 'c1', lead_id: 'l1', email: 'ana@acme.cl', role: 'Gerente de Personas', industry: 'Retail', country: null, city: null,
      sent_at: '2026-09-01T12:00:00Z', replied_at: '2026-09-02T12:00:00Z', reply_intent: 'meeting_request', bounced_at: null }],
    leads: [{ id: 'l1', title: 'Gerente de Personas', industry: 'Retail', country: 'Chile', city: 'Santiago' }],
    unified_crm_data: [{ id: 'lead_saved|l1', stage: 'closed_won' }],
  }, { signatures: { profile_extended: { targetRoles: ['Personas'] } } });
  const result = await readCoworkIcp(client as never, { userId: USER, organizationId: ORG }, '  AXIS   para RR. HH. ');
  assert.equal(result.offer, 'AXIS para RR. HH.');
  assert.deepEqual([result.totals.positive, result.totals.meetings, result.totals.won], [1, 1, 1]);
  assert.equal(result.segments.location.groups[0].value, 'Santiago');
  assert.equal(result.coverage?.fitDeclared, 1);
  assert.equal('partial' in result, false);
  await assert.rejects(readCoworkIcp(client as never, { userId: USER, organizationId: ORG }, 'x'.repeat(301)));
});

test('a failed read is an error, never an empty history', async () => {
  const chain = { select() { return chain; }, eq() { return chain; }, order() { return chain; },
    async range() { return { data: null, error: { message: 'private' } }; }, async maybeSingle() { return { data: null, error: null }; } };
  await assert.rejects(readCoworkIcp({ from: () => chain } as never, { userId: USER, organizationId: ORG }, ''), /historial/);
});

test('«Por escribir» counts in the coverage, once for the saved contact it came from', async () => {
  const client = fakeClient({
    contacted_leads: [],
    leads: [{ id: 'l1', title: 'Gerente de Personas', industry: 'Retail', country: 'Chile', city: 'Santiago' },
      { id: 'l2', title: 'Jefa de Personas', industry: 'Retail', country: 'Chile', city: 'Santiago' }],
    enriched_leads: [{ id: 'e1', title: 'Gerente de Personas', organization_industry: 'Retail', country: 'Chile', city: 'Santiago', source_saved_lead_id: 'l1' },
      { id: 'e2', title: 'Gerenta de Personas', organization_industry: 'Retail', country: 'Chile', city: 'Santiago', source_saved_lead_id: null }],
    unified_crm_data: [],
  }, { signatures: { profile_extended: { targetRoles: ['Personas'] } } });
  const result = await readCoworkIcp(client as never, { userId: USER, organizationId: ORG }, '');
  assert.equal(result.coverage?.savedContacts, 3, 'e1 stands for l1');
  assert.equal(result.coverage?.fitNotContacted, 3);
});
