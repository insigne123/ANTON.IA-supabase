import assert from 'node:assert/strict';
import test from 'node:test';
import { call, reply, ScriptedModel } from '@/lib/agent-harness/scripted';
import {
  companyRelationSettings, domainLabel, forgetCompanyRelations, ownCompanyRelation, readSellerCompany, relateCompanies, relatedCompanyNames,
  type CompanyRelationSettings, type SellerCompany,
} from './company-relations';

// Fictional companies, with the shape of the 6 Nov 2026 case: a staffing company whose saved contacts had its own people and competitors'.
const settings: CompanyRelationSettings = { model: 'claude-haiku-5-5', deadlineMs: 9_000 };
const seller: SellerCompany = {
  organizationId: 'org-1', names: ['PersonalBoreal'], domains: ['personalboreal.com', 'personalboreal.com'],
  sector: 'Outsourcing de procesos y recursos humanos',
  description: 'PersonalBoreal entrega personal transitorio, outsourcing de procesos y reclutamiento y selección.',
  services: 'Servicios Transitorios (EST)\nOutsourcing logístico\nReclutamiento y selección',
};
const deliver = (empresas: unknown[]) => call('entregar_relaciones', { empresas });
const brief = (model: ScriptedModel, index = 0) => JSON.parse(String(model.requests[index].messages[0].content));

test('the competitor check is off unless the flag is on and there is a key, and its time is bounded', () => {
  assert.equal(companyRelationSettings({}), null);
  assert.equal(companyRelationSettings({ COMPANY_RELATIONS_AI_ENABLED: 'true' }), null, 'without a key there is no Claude');
  assert.equal(companyRelationSettings({ ANTHROPIC_API_KEY: 'k' }), null, 'the key alone turns nothing on');
  assert.deepEqual(companyRelationSettings({ COMPANY_RELATIONS_AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'k' }), { model: 'claude-haiku-5-5', deadlineMs: 9_000 });
  assert.deepEqual(companyRelationSettings({ COMPANY_RELATIONS_AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'k', COMPANY_RELATIONS_AI_DEADLINE_MS: '1' }),
    { model: 'claude-haiku-5-5', deadlineMs: 3_000 });
});

test('a domain names its company with any ending, and a public mailbox names none', () => {
  assert.equal(domainLabel('personalboreal.com'), 'personalboreal');
  assert.equal(domainLabel('https://www.personalboreal.cl/contacto'), 'personalboreal');
  assert.equal(domainLabel('ana@mail.personalboreal.com.pe'), 'personalboreal');
  assert.equal(domainLabel('ana@gmail.com'), null);
  assert.equal(domainLabel('ana@hotmail.es'), null);
  assert.equal(domainLabel('abc.cl'), null, 'too short to be sure');
  assert.equal(domainLabel(''), null);
});

test('the own company is found without AI, by its name or by its domain', () => {
  const own = (company: Parameters<typeof ownCompanyRelation>[1]) => ownCompanyRelation(seller, company)?.relation ?? null;
  assert.equal(own({ name: 'PersonalBoreal' }), 'propia');
  assert.equal(own({ name: 'Personal Boreal S.A.' }), 'propia', 'spaces and the legal form do not count');
  assert.equal(own({ name: 'PersonalBoreal Perú' }), 'propia', 'nor the country');
  assert.equal(own({ name: 'Otra Empresa', email: 'reclutadora@personalboreal.cl' }), 'propia', 'the .cl of the same company');
  assert.equal(own({ name: null, domain: 'https://personalboreal.com.pe' }), 'propia');
  assert.equal(own({ name: 'Grupo Sur', email: 'ana@gmail.com' }), null);
  assert.equal(own({ name: 'Retail Andino', email: 'ana@retailandino.cl' }), null);
  // A short name counts only as the whole name: «Andes Motor» is not «Andes».
  const short = { names: ['Andes'], domains: [] };
  assert.equal(ownCompanyRelation(short, { name: 'Andes' })?.relation, 'propia');
  assert.equal(ownCompanyRelation(short, { name: 'Andes Motor' }), null);
});

test('one call says which companies sell the same; each company is asked once, and only by its name, sector and domain', async () => {
  forgetCompanyRelations();
  // Only the companies to leave out come back; one it made up (e9) is ignored.
  const model = new ScriptedModel([reply([deliver([
    { id: 'e1', relacion: 'competencia', motivo: 'Empresa de outsourcing de personal' },
    { id: 'e2', relacion: 'competencia', motivo: 'Empresa de servicios de personal' },
    { id: 'e4', relacion: 'mismo_grupo', motivo: 'Filial del mismo grupo' },
    { id: 'e9', relacion: 'competencia' },
  ])])]);
  const run = await relateCompanies(seller, [
    { key: 'l1', name: 'Talento Austral Outsourcing', email: 'jefa@talentoaustral.cl' },
    { key: 'l2', name: 'Talento Austral Outsourcing', email: 'coordinador@talentoaustral.cl' },
    { key: 'l3', name: 'Personal Andes Perú', industry: 'human resources' },
    { key: 'l4', name: 'Retail Andino', industry: 'retail', domain: 'retailandino.cl' },
    { key: 'l5', name: 'BorealCap OTEC' },
    { key: 'l6', name: 'Constructora Pacífico' },
    { key: 'l7', name: 'PersonalBoreal', email: 'colega@personalboreal.com' },
  ], settings, {}, { model });
  assert.equal(model.requests.length, 1);
  const asked = brief(model);
  assert.equal(asked.vendedor.empresa, 'PersonalBoreal');
  assert.match(asked.vendedor.que_vende, /Servicios Transitorios/);
  assert.deepEqual(asked.empresas.map((company: { nombre: string }) => company.nombre),
    ['Talento Austral Outsourcing', 'Personal Andes Perú', 'Retail Andino', 'BorealCap OTEC', 'Constructora Pacífico'],
    'the two people of Talento Austral are one company, and the own company is not asked about');
  assert.equal(asked.empresas[0].dominio, 'talentoaustral.cl', 'the domain of a work email tells namesakes apart');
  assert.ok(!JSON.stringify(asked).includes('jefa@'), 'no email reaches the model');
  assert.deepEqual([...run.relations].map(([key, value]) => [key, value.relation, value.via]), [
    ['l7', 'propia', 'nombre'],
    ['l1', 'competencia', 'ia'], ['l2', 'competencia', 'ia'], ['l3', 'competencia', 'ia'], ['l5', 'propia', 'ia'],
  ], 'the companies it did not name, and an id it made up, leave the company in');
  assert.equal(run.relations.get('l3')?.reason, 'Empresa de servicios de personal');

  // What it said is remembered: the next look at the same companies asks nothing.
  const again = new ScriptedModel([]);
  const second = await relateCompanies(seller, [{ key: 'x1', name: 'Talento Austral Outsourcing', email: 'otra@talentoaustral.cl' }, { key: 'x2', name: 'Retail Andino', domain: 'retailandino.cl' }],
    settings, {}, { model: again });
  assert.equal(again.requests.length, 0);
  assert.equal(second.relations.get('x1')?.relation, 'competencia');
  assert.equal(second.relations.has('x2'), false);
  assert.equal(second.fromMemory, 2);
});

test('without Claude, without what the seller sells, or when Claude fails, only the own company is left out', async () => {
  forgetCompanyRelations();
  const companies = [{ key: 'a', name: 'Personal Andes Perú' }, { key: 'b', name: 'PersonalBoreal Chile' }];
  const off = await relateCompanies(seller, companies, null);
  assert.deepEqual([...off.relations.keys()], ['b']);
  const unused = new ScriptedModel([]);
  const noOffer = await relateCompanies({ ...seller, sector: null, description: null, services: null }, companies, settings, {}, { model: unused });
  assert.equal(unused.requests.length, 0);
  assert.deepEqual([...noOffer.relations.keys()], ['b']);
  const failing = new ScriptedModel([]);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failed = await relateCompanies(seller, companies, settings, {}, { model: failing });
    assert.deepEqual([...failed.relations.keys()], ['b']);
  } finally {
    console.warn = warn;
  }
  // A failed call remembers nothing: the next look asks again, and this time it answers.
  const retry = new ScriptedModel([reply([deliver([{ id: 'e1', relacion: 'competencia' }])])]);
  const answered = await relateCompanies(seller, companies, settings, {}, { model: retry });
  assert.equal(retry.requests.length, 1);
  assert.equal(answered.relations.get('a')?.relation, 'competencia');
  assert.equal((await relateCompanies(null, companies, settings)).relations.size, 0, 'without a seller there is nothing to compare');
});

test('the seller is the «Ficha de la empresa», with the person’s company name and work email; a failed read is no seller', async () => {
  const client = {
    from(table: string) {
      const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => (table === 'organization_company_profile'
        ? { data: { fields: { companyName: 'PersonalBoreal', website: 'https://personalboreal.com', sector: 'Outsourcing', description: 'Personal transitorio', services: 'EST' } }, error: null }
        : { data: null, error: null }) };
      return chain;
    },
  };
  const found = await readSellerCompany(client as never, { userId: 'u', organizationId: 'org-1' }, { company_name: 'Personal Boreal', email: 'ana@personalboreal.cl' });
  assert.deepEqual(found, { organizationId: 'org-1', names: ['PersonalBoreal', 'Personal Boreal'], domains: ['personalboreal.com', 'personalboreal.cl'],
    sector: 'Outsourcing', description: 'Personal transitorio', services: 'EST' });
  const broken = { from() { throw new Error('down'); } };
  const fallback = await readSellerCompany(broken as never, { userId: 'u', organizationId: 'org-1' }, { company_name: 'Personal Boreal', email: 'ana@personalboreal.cl' });
  assert.deepEqual(fallback?.names, ['Personal Boreal'], 'without the «Ficha», the person’s own «Perfil»');
});

test('the companies left out read as a short list', () => {
  assert.equal(relatedCompanyNames([]), '');
  assert.equal(relatedCompanyNames(['Talento Austral']), 'Talento Austral');
  assert.equal(relatedCompanyNames(['Talento Austral', 'Personal Andes', 'Talento Austral']), 'Talento Austral y Personal Andes');
  assert.equal(relatedCompanyNames(['A1', 'B2', 'C3', 'D4', 'E5']), 'A1, B2, C3 y 2 más');
});
