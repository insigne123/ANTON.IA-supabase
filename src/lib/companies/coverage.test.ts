import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedRow } from '@/lib/unified-sheet-types';
import { buildCompanies, classifyRole, companyDomainOf, companyInitials, companyKey, coverageGrid, industryLabel, mainArea, sizeBands } from './coverage';

const row = (patch: Partial<UnifiedRow>): UnifiedRow => ({ gid: `lead_saved|${Math.random()}`, sourceId: 'x', status: 'saved', kind: 'lead_saved', ...patch });

test('a cargo says the area and the level, in Spanish or English', () => {
  const cases: Array<[string, string, string]> = [
    ['Gerente de Personas', 'personas', 'gerencia'],
    ['Jefa de Selección', 'personas', 'jefatura'],
    ['Analista de Remuneraciones', 'personas', 'equipo'],
    ['Subgerente de RR.HH.', 'personas', 'gerencia'],
    ['HR Business Partner', 'personas', 'equipo'],
    ['Gerente General', 'general', 'alta'],
    ['Dueño', 'general', 'alta'],
    ['Gerente General de Operaciones', 'operaciones', 'alta'],
    ['CFO', 'finanzas', 'alta'],
    ['Gerente de Administración y Finanzas', 'finanzas', 'gerencia'],
    ['Jefe de Compras', 'compras', 'jefatura'],
    ['Key Account Manager', 'comercial', 'jefatura'],
    ['Jefe de Seguridad de la Información', 'ti', 'jefatura'],
    ['Jefe de Prevención de Riesgos', 'prevencion', 'jefatura'],
    ['Product Owner', 'otra', 'equipo'],
    ['Fiscal', 'legal', 'equipo'],
    ['Vicepresidente de Ventas', 'comercial', 'gerencia'],
  ];
  for (const [title, area, level] of cases) assert.deepEqual(classifyRole({ title }), { area, level }, title);
  // Without a cargo, Apollo's tags.
  assert.deepEqual(classifyRole({ title: null, seniority: 'director', departments: ['master_finance'] }), { area: 'finanzas', level: 'gerencia' });
  assert.deepEqual(classifyRole({ title: '', seniority: null, departments: [] }), { area: 'otra', level: 'equipo' });
});

test('one company however it is written, one person however many times they were saved', () => {
  assert.equal(companyKey('Retail Sur S.A.'), companyKey('RETAIL SUR SA'));
  assert.equal(companyKey('Logística Norte SpA'), 'logistica norte');
  const { companies } = buildCompanies([
    row({ name: 'Paula Rojas', email: 'paula@retailsur.cl', company: 'Retail Sur S.A.', title: 'Jefa de Selección', companySize: 900, industry: 'retail' }),
    row({ gid: 'contacted|1', kind: 'contacted', status: 'sent', name: 'Paula Rojas', email: 'PAULA@retailsur.cl', company: 'RETAIL SUR SA', title: 'Jefa de Selección', stage: 'meeting' }),
    row({ name: 'Andrés Soto', company: 'Retail Sur', title: 'Gerente General' }),
    row({ name: 'Matías Fuentes', company: 'Logística Norte', title: 'Gerente de Personas', stage: 'closed_won' }),
    row({ kind: 'opportunity', company: 'Constructora Austral', title: null }),
    row({ name: 'Sin empresa', company: null }),
  ]);
  assert.deepEqual(companies.map(company => [company.name, company.people.length, company.stage]), [
    ['Retail Sur', 2, 'meeting'], ['Logística Norte', 1, 'closed_won'],
  ], 'the open deal first, then the won one; opportunities and people without a company stay out');
  assert.equal(companies[0].size, 900);
  assert.equal(companies[0].industry, 'retail');
  assert.deepEqual(companies[0].people.map(person => [person.name, person.level]), [['Andrés Soto', 'alta'], ['Paula Rojas', 'jefatura']], 'the top of the company first');
});

test('who decides, who uses and who pays, by the area you sell to', () => {
  assert.equal(mainArea(['Gerente de Personas', 'Jefe de Selección', 'Gerente General'], []), 'personas', 'from the profile');
  assert.equal(mainArea([], [{ area: 'operaciones' }, { area: 'operaciones' }, { area: 'general' }, { area: 'finanzas' }]), 'operaciones', 'else from the CRM');
  assert.equal(mainArea([], []), null);

  const rows = [
    row({ name: 'Paula Rojas', company: 'Retail Sur', title: 'Jefa de Selección', companySize: 900 }),
    row({ name: 'Andrés Soto', company: 'Retail Sur', title: 'Gerente de Personas' }),
  ];
  const big = buildCompanies(rows, { targetRoles: ['Gerente de Personas'] }).companies[0];
  assert.deepEqual(big.committee.map(slot => [slot.role, slot.people.map(person => person.name)]), [
    ['decide', ['Andrés Soto']], ['usa', ['Paula Rojas']], ['paga', []],
  ]);
  assert.equal(big.covered, 2);
  assert.ok(big.committee[2].titles.includes('Gerente de Finanzas'), 'the gap says whom to look for');

  // In a small company the owner pays too.
  const small = buildCompanies([row({ name: 'Rosa Díaz', company: 'Aseos del Sur', title: 'Dueña', companySize: 30 })], { targetRoles: ['Jefe de Operaciones'] }).companies[0];
  assert.deepEqual(small.committee.map(slot => [slot.role, slot.people.length]), [['decide', 1], ['usa', 0], ['paga', 1]]);
  const grid = coverageGrid(small, 'operaciones');
  assert.deepEqual(grid.map(item => item.area), ['general', 'operaciones', 'finanzas', 'compras'], 'the areas that matter, even when empty');
  assert.equal(grid[0].cells[0][0].name, 'Rosa Díaz');
});

test('the name it is written with most often and the rubro in Spanish', () => {
  const { companies } = buildCompanies([
    row({ name: 'A', company: 'Logística Norte SpA' }), row({ name: 'B', company: 'Logística Norte' }), row({ name: 'C', company: 'Logística Norte' }),
  ]);
  assert.equal(companies[0].name, 'Logística Norte');
  assert.equal(industryLabel('logistics & supply chain'), 'Logística');
  assert.equal(industryLabel('retail'), 'Retail');
  assert.equal(industryLabel('servicios de aseo'), 'Servicios de aseo', 'what is not Apollo stays, with a capital');
  assert.equal(industryLabel(''), null);
});

test('the sizes of companies like this one', () => {
  assert.deepEqual(sizeBands(900), ['201-500', '501-1000', '1001-5000']);
  assert.deepEqual(sizeBands(8), ['1-10', '11-50']);
  assert.deepEqual(sizeBands(null), []);
});

test('the company domain comes from the enrichment, else from the work emails of its people, never from a free mailbox', () => {
  assert.equal(companyDomainOf([{ companyDomain: 'https://www.RetailSur.cl/', email: 'ana@otra.cl' }]), 'retailsur.cl');
  assert.equal(companyDomainOf([{ email: 'ana@gmail.com' }, { email: 'luis@grupoexpro.cl' }, { email: 'eva@grupoexpro.cl' }, { email: 'jo@expro-rrhh.cl' }]), 'grupoexpro.cl');
  assert.equal(companyDomainOf([{ email: 'ana@gmail.com' }, { email: null }]), null);
  const { companies } = buildCompanies([row({ company: 'Grupo Expro', email: 'luis@grupoexpro.cl', title: 'Gerente General' })]);
  assert.equal(companies[0].domain, 'grupoexpro.cl');
});

test('a company without a logo shows the initials of its name, not of its linking words', () => {
  assert.equal(companyInitials('Ministerio de Obras Públicas'), 'MO');
  assert.equal(companyInitials('Grupo Siglo Outsourcing'), 'GS');
  assert.equal(companyInitials('SONDA'), 'SO');
  assert.equal(companyInitials('Cencosud S.A.'), 'CS');
});
