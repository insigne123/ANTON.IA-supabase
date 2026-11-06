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
    let personal=false;
    const chain = {
      select() { return chain; },
      eq(column: string, value: string) { if(column==='user_id'){assert.equal(value,USER);personal=true;}else{assert.equal(column, 'organization_id'); assert.equal(value, ORG);}return chain; },
      not() { return chain; },
      order() { return chain; },
      async range(start: number, end: number) { return { data: (tables[table] || []).filter((row:any)=>!personal||row.user_id===USER).slice(start, end + 1), error: null }; },
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

test('Home recommendations are only this user while Cowork explicitly retains its organization scope',async()=>{
  const client=fakeClient({leads:[row('own','Gerente','Retail',null,{user_id:USER}),row('other','Gerente','Retail',null,{user_id:'another'})]},{});
  const locks=async()=>({enabled:false,byEmail:{},byProviderId:{},byLinkedin:{}});
  const personal=await readCoworkLeadRecommendations(client as never,{userId:USER,organizationId:ORG},'',{locks:locks as never,personal:true});
  assert.equal(personal.scope,'personal_lead_recommendations');assert.deepEqual(personal.top.map(row=>row.leadId),['own']);
  const organization=await readCoworkLeadRecommendations(client as never,{userId:USER,organizationId:ORG},'',{locks:locks as never});assert.equal(organization.top.length,2);
});

test('«Por escribir» counts: the enriched copy stands for the saved contact, and a send to the same address is a contact', async () => {
  const client = fakeClient({
    leads: [row('l5', 'Gerente de Personas', 'Retail', null), row('l6', 'Gerente de Personas', 'Retail', 'e1@acme.cl'),
      row('l7', 'Jefe de Personas', 'Retail', null)],
    enriched_leads: [
      { id: 'e1', full_name: 'Elisa Uno', title: 'Gerente de Personas', company_name: 'Acme', organization_name: null, organization_industry: 'Retail',
        email: 'e1@acme.cl', linkedin_url: null, city: null, country: null, contacted_count: 0, source_saved_lead_id: 'l5' },
      { id: 'e2', full_name: 'Eva Dos', title: 'Jefa de Personas', company_name: 'Beta', organization_name: null, organization_industry: 'Retail',
        email: 'e2@beta.cl', linkedin_url: null, city: null, country: null, contacted_count: 0, source_saved_lead_id: null },
      { id: 'e3', full_name: 'Ema Tres', title: 'Gerenta de Personas', company_name: 'Gama', organization_name: null, organization_industry: 'Retail',
        email: 'e3@gama.cl', linkedin_url: null, city: null, country: null, contacted_count: 1, source_saved_lead_id: null },
    ],
    contacted_leads: [{ lead_id: null, email: 'E2@beta.cl' }],
    lead_research_reports: [{ lead_id: 'e1', email: null, completed_at: '2026-09-20T12:00:00Z' }],
  }, { signatures: { profile_extended: { targetRoles: ['Personas'] } } });
  const locks = async () => ({ enabled: true, byEmail: {}, byProviderId: {}, byLinkedin: {} });
  const result = await readCoworkLeadRecommendations(client as never, { userId: USER, organizationId: ORG }, '', { locks: locks as never });
  assert.deepEqual(result.top.map(item => [item.leadId, item.list]), [['e1', 'por_escribir'], ['l7', 'por_completar']],
    'l5 and l6 are e1; e2 got an email and e3 was contacted');
  assert.deepEqual(result.top[0].missing, [], 'e1 has an email and was researched');
  assert.ok(result.top[0].reasons.includes('ya está investigada'));
  assert.equal(result.notContacted, 2);
});

test('people of the seller’s own company and of its competitors are never recommended, and the answer says how many and which', async () => {
  // The shape of the 6 Nov 2026 report, with fictional companies: recruiters of the own company and of a competitor had the title asked for.
  const { companyRelator } = await import('@/lib/server/company-relations');
  const client = fakeClient({
    leads: [
      row('c1', 'Jefa de Reclutamiento y Selección', 'Retail', 'c1@retailandino.cl', { company: 'Retail Andino' }),
      row('o1', 'Coordinadora de Reclutamiento y Selección', 'human resources', 'o1@personalboreal.cl', { company: 'Personal Boreal Perú' }),
      row('o2', 'Reclutador Senior', 'human resources', 'o2@personalboreal.com', { company: 'Otra razón social' }),
      row('k1', 'Jefe de Reclutamiento y Selección', '—', null, { company: 'Talento Austral Outsourcing' }),
      row('k2', 'Coordinador de Reclutamiento y Selección', '—', null, { company: 'Talento Austral Outsourcing' }),
    ],
  }, { company_name: 'PersonalBoreal', email: 'ana@personalboreal.com', signatures: { profile_extended: { targetRoles: ['Reclutamiento y Selección', 'Reclutador'] } } });
  const locks = async () => ({ enabled: false, byEmail: {}, byProviderId: {}, byLinkedin: {} });
  let profileSeen: Record<string, unknown> | null = null;
  const asked: string[] = [];
  const result = await readCoworkLeadRecommendations(client as never, { userId: USER, organizationId: ORG }, '', {
    locks: locks as never,
    seller: async profile => {
      profileSeen = profile;
      return { organizationId: ORG, names: ['PersonalBoreal'], domains: ['personalboreal.com'], sector: 'Outsourcing de personal', description: 'Personal transitorio', services: 'EST' };
    },
    // The own company as the app finds it (no AI); the competitor as Claude would answer.
    relate: async (seller, companies) => {
      asked.push(...companies.map(company => company.key));
      const relations = await companyRelator({})(seller, companies);
      for (const company of companies) if (company.name === 'Talento Austral Outsourcing') relations.set(company.key, { relation: 'competencia', reason: 'Outsourcing de personal', via: 'ia' });
      return relations;
    },
  });
  assert.equal((profileSeen as { email?: string } | null)?.email, 'ana@personalboreal.com', 'the profile row read is the one the seller is built from');
  assert.deepEqual(asked.sort(), ['c1', 'k1', 'k2', 'o1', 'o2']);
  assert.deepEqual(result.top.map(item => item.leadId), ['c1'], 'only the possible customer is recommended');
  assert.equal(result.excludedOwnCompany, 2, 'by its name (Personal Boreal Perú) and by its email (personalboreal.com)');
  assert.equal(result.excludedCompetitors, 2);
  assert.deepEqual(result.competitorCompanies, ['Talento Austral Outsourcing']);
  assert.equal(result.fitting, 1);
});
