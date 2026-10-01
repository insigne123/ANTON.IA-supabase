import assert from 'node:assert/strict';
import test from 'node:test';

import { hasUsableDraftSellerOfferV2 } from '@/lib/server/draft-context-v2';
import { loadSellerProfile } from '@/lib/server/seller-profile';

const ORG = 'e73dd11f-c8db-4ffc-9711-47dc74295064';
const OWNER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const OUTSIDER = '44444444-4444-4444-8444-444444444444';

class Query {
  private filters: Array<(row: any) => boolean> = [];
  private single = false;
  constructor(private readonly rows: any[]) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.single = true; return this; }
  then(resolve: (value: any) => any, reject?: (reason: unknown) => any) {
    const data = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    return Promise.resolve({ data: this.single ? data[0] || null : data, error: null }).then(resolve, reject);
  }
}

function admin(profiles: any[]) {
  const tables: Record<string, any[]> = {
    organization_members: [
      { organization_id: ORG, user_id: OWNER, role: 'owner', created_at: '2026-08-01T00:00:00Z' },
      { organization_id: ORG, user_id: ADMIN, role: 'admin', created_at: '2026-08-02T00:00:00Z' },
      { organization_id: ORG, user_id: MEMBER, role: 'member', created_at: '2026-09-01T00:00:00Z' },
      { organization_id: 'other-org', user_id: OUTSIDER, role: 'owner', created_at: '2026-07-01T00:00:00Z' },
    ],
    profiles,
  };
  return { from: (table: string) => new Query(tables[table] || []) };
}

const offer = (id: string, valueProposition: string, extra: Record<string, unknown> = {}) => ({
  id, full_name: `Persona ${id.slice(0, 2)}`, job_title: 'Gerente', company_name: 'GrupoExpro', company_domain: 'grupoexpro.com',
  signatures: { profile_extended: { valueProposition, services: 'Personal transitorio, Outsourcing', ...extra } },
});

test('a member without an offer drafts with the organization offer, still as themselves', async () => {
  const profiles = [
    { id: MEMBER, full_name: 'Marta Rojas', job_title: 'Ejecutiva comercial', company_name: null, signatures: {} },
    { id: OWNER, full_name: 'Dueño', company_name: 'GrupoExpro', signatures: {} },
    offer(ADMIN, 'Personal transitorio listo en 48 horas para peaks de temporada'),
    offer(OUTSIDER, 'Otra empresa, otra oferta'),
  ];
  const seller = await loadSellerProfile(MEMBER, ORG, admin(profiles));
  assert.equal(seller.name, 'Marta Rojas');
  assert.equal(seller.jobTitle, 'Ejecutiva comercial');
  assert.equal(seller.companyName, 'GrupoExpro');
  assert.equal(seller.valueProposition, 'Personal transitorio listo en 48 horas para peaks de temporada');
  assert.deepEqual(seller.services, ['Personal transitorio', 'Outsourcing']);
  assert.ok(hasUsableDraftSellerOfferV2(seller), 'the draft is no longer blocked');
});

test('the person\'s own offer always wins, and nothing is borrowed without an organization or from another one', async () => {
  const own = await loadSellerProfile(MEMBER, ORG, admin([offer(MEMBER, 'Selección de ejecutivos con garantía de 90 días'), offer(ADMIN, 'Oferta del admin para todos')]));
  assert.equal(own.valueProposition, 'Selección de ejecutivos con garantía de 90 días');

  const withoutOrg = await loadSellerProfile(MEMBER, null, admin([{ id: MEMBER, full_name: 'Marta', signatures: {} }, offer(ADMIN, 'Oferta del admin para todos')]));
  assert.equal(hasUsableDraftSellerOfferV2(withoutOrg), false);

  const onlyOutsider = await loadSellerProfile(MEMBER, ORG, admin([{ id: MEMBER, full_name: 'Marta', signatures: {} }, offer(OUTSIDER, 'Otra empresa, otra oferta')]));
  assert.equal(hasUsableDraftSellerOfferV2(onlyOutsider), false, 'never another organization\'s offer');
});

test('the seller read by drafts carries what «Perfil» now declares, and an old profile keeps its exact shape', async () => {
  const { normalizeSellerProfile } = await import('@/lib/server/seller-profile');
  const legacy = normalizeSellerProfile({ company_name: 'Acme', signatures: { profile_extended: { services: 'Outsourcing, Selección', valueProposition: 'Personal listo en 48 horas' } } });
  assert.deepEqual(Object.keys(legacy).sort(), ['companyDomain', 'companyName', 'description', 'jobTitle', 'name', 'proofPoints', 'sector', 'services', 'valueProposition'],
    'no new keys when they are empty, so the draft identity hash of existing profiles does not move');
  assert.deepEqual(legacy.services, ['Outsourcing', 'Selección']);

  const seller = normalizeSellerProfile({ company_name: 'Acme', signatures: { profile_extended: {
    services: 'Personal temporal para retail, logística y agroindustria en temporada alta',
    painPoints: ['Rotación alta'], differentiators: ['Cobertura nacional'], referenceClients: ['Falabella'],
    targetRoles: ['Gerente de Personas'], targetIndustries: ['Retail'],
  } } });
  assert.deepEqual(seller.services, ['Personal temporal para retail, logística y agroindustria en temporada alta'], 'a sentence is not cut into fragments');
  assert.deepEqual(seller.painPoints, ['Rotación alta']);
  assert.deepEqual(seller.differentiators, ['Cobertura nacional']);
  assert.deepEqual(seller.referenceClients, ['Falabella']);
  assert.deepEqual(seller.targetRoles, ['Gerente de Personas']);
  assert.deepEqual(seller.targetIndustries, ['Retail']);
});
