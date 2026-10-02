import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkLeadRecommendations } from './lead-recommend-read';

const USER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';

function fakeClient(tables: Record<string, unknown[]>, profile: unknown) {
  return { from(table: string) {
    if (table === 'profiles') {
      const chain = { select() { return chain; }, eq() { return chain; }, async maybeSingle() { return { data: profile, error: null }; } };
      return chain;
    }
    const chain = {
      select() { return chain; },
      eq(column: string, value: string) { assert.equal(column, 'organization_id'); assert.equal(value, ORG); return chain; },
      not() { return chain; },
      order() { return chain; },
      async range(start: number, end: number) { return { data: (tables[table] || []).slice(start, end + 1), error: null }; },
    };
    return chain;
  } };
}
const row = (id: string, title: string, industry: string, email: string | null, extra: Record<string, unknown> = {}) => ({
  id, name: `Persona ${id}`, title, company: `Empresa ${id}`, industry, email, linkedin_url: null, last_investigated_at: null, last_contacted_at: null, city: null, country: null, ...extra });

test('the offer asked about decides; without it, the customer of «Perfil»; contacted people and other members’ people never come back', async () => {
  const client = fakeClient({
    leads: [row('l1', 'Jefa de RR. HH.', 'Retail', 'l1@acme.cl'), row('l2', 'Gerente de Personas', 'Retail', 'l2@acme.cl'),
      row('l3', 'Jefe de Selección', 'Minería', null), row('l4', 'Gerente de RR. HH.', 'Retail', 'l4@acme.cl', { last_contacted_at: '2026-09-01T00:00:00Z' })],
    contacted_leads: [{ lead_id: 'l1' }],
  }, { signatures: { profile_extended: { targetRoles: ['Selección'] } } });
  let asked: string[] = [];
  const locks = async (_client: unknown, _scope: unknown, input: { emails?: string[] }) => {
    asked = input.emails || [];
    return { enabled: true, byEmail: { 'l2@acme.cl': { status: 'active' as const, ownerName: 'Ana', mine: false, replied: false, lastContactedAt: null } }, byProviderId: {}, byLinkedin: {} };
  };
  const asked1 = await readCoworkLeadRecommendations(client as never, { userId: USER, organizationId: ORG }, 'RR. HH., personas', { locks: locks as never });
  assert.deepEqual(asked1.criteria, { terms: ['RR. HH.', 'personas'], locations: [], source: 'pedido' });
  assert.deepEqual(asked1.top.map(item => item.leadId), ['l3'], 'l1 and l4 were contacted and l2 is Ana’s; l3 is of the same area as «RR. HH.»');
  assert.equal(asked1.excludedByTeam, 1);
  assert.deepEqual(asked, ['l2@acme.cl']);
  const fromProfile = await readCoworkLeadRecommendations(client as never, { userId: USER, organizationId: ORG }, '', { locks: locks as never });
  assert.equal(fromProfile.criteria.source, 'perfil');
  assert.deepEqual(fromProfile.top.map(item => item.leadId), ['l3']);
  assert.deepEqual(fromProfile.top[0].missing, ['buscar su correo', 'investigarla']);
});
