import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendLeads, recommendTerms, scoreRecommendLead, type RecommendLead } from './lead-recommend';

const lead = (id: string, title: string | null, industry: string | null, extra: Partial<RecommendLead> = {}): RecommendLead => ({
  id, name: `Persona ${id}`, title, company: `Empresa ${id}`, industry, email: null, linkedinUrl: null, researchedAt: null, city: null, country: null, ...extra,
});

test('the terms of an offer are split by commas, semicolons or lines, once each', () => {
  assert.deepEqual(recommendTerms('RR. HH., selección; seguridad privada\nretail, RR. HH., x'), ['RR. HH.', 'selección', 'seguridad privada', 'retail']);
  assert.deepEqual(recommendTerms(''), []);
});

test('a contact scores by fit first, then level and readiness, with its reasons and what is missing', () => {
  const criteria = { terms: ['RR. HH.', 'retail'], locations: ['Antofagasta'], source: 'pedido' as const };
  const ready = scoreRecommendLead(lead('a', 'Gerenta de RR. HH.', 'Retail', { email: 'a@acme.cl', researchedAt: '2026-09-01', city: 'Antofagasta' }), criteria);
  assert.equal(ready.score, 98);
  assert.deepEqual(ready.reasons, ['su cargo calza con «RR. HH.»', 'su empresa calza con «retail»', 'decide (dirección)', 'está en Antofagasta', 'tiene correo', 'ya está investigada']);
  assert.deepEqual(ready.missing, []);
  const bare = scoreRecommendLead(lead('b', 'Analista de RR. HH.', 'Minería'), criteria);
  assert.equal(bare.score, 43);
  assert.deepEqual(bare.missing, ['buscar su correo', 'investigarla']);
  assert.equal(scoreRecommendLead(lead('c', 'Gerente de Finanzas', 'Minería'), criteria).fits, false);
});

test('only people nobody wrote to and nobody else is working, the fitting ones first', () => {
  const leads = [
    lead('a', 'Jefa de RR. HH.', 'Retail', { email: 'a@acme.cl' }),
    lead('b', 'Gerente de RR. HH.', 'Retail', { email: 'b@acme.cl' }),
    lead('c', 'Gerente de Finanzas', 'Retail'),
    lead('d', 'Jefe de Selección', 'Minería', { email: 'd@acme.cl' }),
    lead('e', 'Gerenta de Personas', 'Retail', { email: 'E@Acme.cl' }),
  ];
  const result = recommendLeads({ leads, contacted: new Set(['a']), lockedByOthers: new Map([['e@acme.cl', 'Ana']]),
    criteria: { terms: ['RR. HH.', 'selección', 'retail'], locations: [], source: 'perfil' } });
  assert.deepEqual(result.top.map(item => item.leadId), ['b', 'd', 'c'], 'a was contacted and e is Ana’s; c fits by industry only');
  assert.deepEqual([result.notContacted, result.excludedByTeam, result.fitting, result.readyToWrite, result.needEmail], [4, 1, 3, 2, 1]);
  assert.deepEqual(result.byArea[0], { area: 'Personas y RR. HH.', people: 2 });
});

test('without terms the order is level and readiness, and it says so', () => {
  const result = recommendLeads({ leads: [lead('a', 'Analista', null), lead('b', 'Gerente General', null, { email: 'b@acme.cl' })],
    contacted: new Set(), lockedByOthers: new Map(), criteria: { terms: [], locations: [], source: 'ninguno' } });
  assert.deepEqual(result.top.map(item => item.leadId), ['b', 'a']);
  assert.equal(result.fitting, null);
  assert.match(result.limitation, /Sin cargos ni industrias/);
});
