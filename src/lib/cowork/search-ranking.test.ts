import assert from 'node:assert/strict';
import test from 'node:test';

import { COWORK_SEARCH_ROLE_NOTE, coworkFitReason, rankCoworkSearchPeople } from './search-ranking';
import { classifyAudienceRole } from './audience-analysis';

// What the model writes for «revisión de antecedentes» when it proposes the search: who decides that purchase.
const rolePolicy = { decisionTerms: ['gerente de personas', 'jefe de reclutamiento', 'gerente general'], userTerms: ['reclutador'],
  referralTerms: ['analista'], excludeTerms: ['práctica'] };

const person = (id: string, title: string | null, company: string, extra: { industry?: string; employees?: number } = {}) =>
  ({ id, title, companyKey: company, company, ...extra });

test('who may decide the purchase comes first, a few per company, grouped by company, and nobody is dropped', () => {
  const people = [
    person('a1', 'Analista de Personas', 'acme'),
    person('a2', 'Gerente de Personas', 'acme', { industry: 'staffing & recruiting', employees: 1200 }),
    person('a3', 'Jefe de Reclutamiento', 'acme'),
    person('a4', 'Gerente General', 'acme'),
    person('b1', 'Practicante de Selección (práctica)', 'beta'),
    person('b2', 'Jefe de Reclutamiento', 'beta'),
    person('c1', 'Chofer', 'gamma'),
    person('c2', null, 'gamma'),
  ];
  const { items, total } = rankCoworkSearchPeople(people, { rolePolicy, limit: 10, companyOrder: ['beta', 'acme', 'gamma'] });
  assert.equal(total, 8, 'everyone the provider returned is ranked');
  assert.deepEqual(items.map(item => item.id), ['b2', 'b1', 'a2', 'a3', 'a4', 'a1', 'c1', 'c2'],
    'beta came first among the companies and has a buyer; each company keeps its people together');
  assert.equal(items.find(item => item.id === 'a2')?.role, 'decision_maker_candidate');
  assert.equal(items.find(item => item.id === 'b1')?.role, 'excluded_by_criteria', 'excluded by the criteria, kept and last of its company');
  assert.equal(items.find(item => item.id === 'a2')?.fit, 'Posible comprador: cargo con «gerente de personas» · staffing & recruiting, 1.200 empleados');
  assert.equal(items.find(item => item.id === 'a1')?.fit, 'Puede derivarte: cargo con «analista»');
  assert.equal(items.find(item => item.id === 'b1')?.fit, 'Fuera de tus criterios: cargo con «práctica»');
  assert.equal(items.find(item => item.id === 'c2')?.fit, 'Sin cargo informado');
  assert.match(COWORK_SEARCH_ROLE_NOTE, /hipótesis/);
});

test('three of a company before a fourth one, and «Traer más» continues where the list stopped', () => {
  const people = [
    ...['Gerente de Personas', 'Jefe de Reclutamiento', 'Gerente General', 'Gerente de Personas Zona Norte'].map((title, index) => person(`big${index}`, title, 'big')),
    person('small', 'Jefe de Reclutamiento', 'small'),
    person('other', 'Analista', 'other'),
  ];
  const first = rankCoworkSearchPeople(people, { rolePolicy, limit: 4, companyOrder: ['big', 'small', 'other'] });
  assert.deepEqual(first.items.map(item => item.id), ['big0', 'big1', 'big2', 'small'], 'the fourth buyer of a big company waits for another company');
  const next = rankCoworkSearchPeople(people, { rolePolicy, limit: 4, offset: 4, companyOrder: ['big', 'small', 'other'] });
  assert.deepEqual(next.items.map(item => item.id), ['other', 'big3']);
  assert.equal(next.total, 6);
  assert.deepEqual(rankCoworkSearchPeople(people, { rolePolicy, limit: 4, offset: 8 }).items, []);
});

test('without criteria from the model the title alone suggests a role, and says so', () => {
  const { items } = rankCoworkSearchPeople([person('x', 'Asistente', 'one'), person('y', 'CEO', 'two')], { limit: 5 });
  assert.deepEqual(items.map(item => [item.id, item.fit]), [['y', 'Posible comprador por su cargo'], ['x', 'Puede derivarte por su cargo']]);
  assert.equal(coworkFitReason(classifyAudienceRole('Gerente de Personas', { ...rolePolicy, excludeTerms: ['personas'] }), {}),
    'Revisar: el cargo calza con incluir y con excluir «personas»');
});
