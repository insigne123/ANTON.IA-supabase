import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LeadFitAnswerSchema, leadFitBand, leadFitFacts, leadFitKey, leadFitOutcomeStats, leadFitPrompt, leadFitResearch, normalizeLeadFitAssessment,
  seniorityBucket,
} from './core';

test('the same person keeps one key from search to «Por escribir»: LinkedIn first, then the provider id, then the email', () => {
  const search = leadFitKey({ linkedinUrl: 'linkedin.com/in/ana-perez/', providerId: 'apollo-1', email: null });
  const saved = leadFitKey({ linkedinUrl: 'https://www.linkedin.com/in/ana-perez?utm=1', providerId: null, email: 'ana@acme.cl' });
  assert.equal(search, 'li:linkedin.com/in/ana-perez');
  assert.equal(saved, search);
  assert.equal(leadFitKey({ linkedinUrl: 'https://example.com/ana', providerId: 'Apollo-1', email: null }), 'pid:apollo-1');
  assert.equal(leadFitKey({ linkedinUrl: null, providerId: null, email: ' Ana@Acme.CL ' }), 'em:ana@acme.cl');
  assert.equal(leadFitKey({ linkedinUrl: null, providerId: '', email: 'sin correo' }), null);
});

test('each stage reads what it knows: search without the email itself, «Por escribir» with it, research with the report', () => {
  const lead = { title: 'Gerente de Personas', company: 'Acme', industry: 'Retail', companySize: 320, email: 'ana@acme.cl', emailStatus: 'verified',
    hasPhone: true, linkedinUrl: 'linkedin.com/in/ana', leadId: 'lead-1', providerId: 'apollo-1' };
  const search = leadFitFacts('search', lead);
  assert.equal(search.correoDisponible, true);
  assert.equal('correo' in search, false);
  assert.equal(JSON.stringify(search).includes('ana@acme.cl'), false, 'the model reads the person, not their address');
  const saved = leadFitFacts('saved', lead);
  assert.equal(saved.correo, 'verified');
  assert.equal(saved.telefono, true);
  assert.equal('informe' in saved, false);
  const research = { extractos: ['Abrieron 3 tiendas y buscan 40 vendedores.'], calceDelInforme: 80 };
  assert.deepEqual(leadFitFacts('researched', lead, research).informe, research);
  assert.equal('informe' in leadFitFacts('researched', lead, null), false, 'without its report it reads as «Por escribir»');
  for (const facts of [search, saved]) assert.equal(JSON.stringify(facts).includes('lead-1') || JSON.stringify(facts).includes('apollo-1'), false);
});

test('the team results count people, not bounces nor automatic replies, by level and industry', () => {
  const row = (role: string, industry: string, replied: boolean, intent: string | null = null, bounced = false) =>
    ({ role, industry, replied_at: replied ? '2026-10-01' : null, reply_intent: intent, bounced_at: bounced ? '2026-10-01' : null });
  const stats = leadFitOutcomeStats([
    row('Gerente de Personas', 'Retail', true, 'positive'), row('Jefa de Selección', 'Retail', true, 'neutral'),
    row('Analista de RR.HH.', 'Retail', false), row('CEO', 'Minería', true, 'auto_reply'), row('Gerente General', 'Minería', false, null, true),
  ]);
  assert.deepEqual(stats.total, { enviados: 4, respondieron: 2, interesados: 1, tasaRespuesta: 50 });
  assert.deepEqual(stats.porIndustria, [{ nombre: 'retail', enviados: 3, respondieron: 2, interesados: 1, tasaRespuesta: 67 }]);
  assert.equal(stats.porNivel.find(level => level.nombre === 'Dueños y C-level')?.respondieron, 0, 'an automatic reply is not an answer');
  assert.equal(stats.suficiente, false);
  assert.equal(seniorityBucket('Gerente General'), 'Dueños y C-level');
  assert.equal(seniorityBucket('Head of People'), 'Directores y gerentes');
  assert.equal(seniorityBucket('Jefa de Selección'), 'Jefes y subgerentes');
  assert.equal(seniorityBucket('Analista'), 'Analistas y otros');
});

test('a research report gives its telling passages first, without links nor ids, bounded, with its own fit', () => {
  const research = leadFitResearch({
    id: 'r1', url: 'https://acme.cl', sources: [{ url: 'https://acme.cl/news', title: 'Una fuente con un título largo para ver si entra' }],
    company: { description: 'Cadena de tiendas de ropa con presencia en cinco regiones del país.' },
    enhanced: { overview: 'Acme abrió tres tiendas este año y contrata vendedores para la temporada.', pains: ['Alta rotación de vendedores en temporada alta.', 'Alta rotación de vendedores en temporada alta.'] },
    raw: { buyer_intelligence: { fit_score: 82.4 } },
  })!;
  assert.equal(research.extractos[0], 'Acme abrió tres tiendas este año y contrata vendedores para la temporada.');
  assert.equal(research.extractos[1], 'Alta rotación de vendedores en temporada alta.');
  assert.equal(research.extractos.length, 3, 'duplicates and sources are not passages');
  assert.equal(research.calceDelInforme, 82);
  const long = leadFitResearch({ summary: Array.from({ length: 40 }, (_, index) => `Hecho número ${index} sobre la empresa y su operación diaria en Chile.`) })!;
  assert.ok(long.extractos.length <= 14 && long.extractos.join('').length <= 2600);
  assert.equal(leadFitResearch({ id: 'x', url: 'https://acme.cl' }), null);
});

test('the answer is kept bounded: probability 0–100, distinct reasons, one-line summary; bands for the badge', () => {
  const kept = normalizeLeadFitAssessment({ ref: 'L1', probability: 72, summary: '  Calza   el cargo\ny la industria. ',
    factors: [{ effect: 'up', text: 'Gerente de Personas' }, { effect: 'up', text: 'gerente de personas' }, { effect: 'down', text: 'Empresa pequeña' }] });
  assert.deepEqual(kept, { probability: 72, summary: 'Calza el cargo y la industria.', factors: [{ effect: 'up', text: 'Gerente de Personas' }, { effect: 'down', text: 'Empresa pequeña' }] });
  assert.equal(LeadFitAnswerSchema.safeParse({ assessments: [{ ref: 'L1', probability: 120, summary: 'x', factors: [{ effect: 'up', text: 'y' }] }] }).success, false);
  assert.deepEqual([leadFitBand(70), leadFitBand(69), leadFitBand(40), leadFitBand(39)], ['alta', 'media', 'media', 'baja']);
});

test('the prompt carries the stage, the profile, the team results and the previous estimate, with refs instead of keys', () => {
  const prompt = JSON.parse(leadFitPrompt({ stage: 'saved', profile: { empresa: 'Yago', oferta: 'Selección masiva', propuesta: null, servicios: null,
    cargos: ['Gerente de Personas'], industrias: ['Retail'], tamano: null, ubicaciones: [], dolores: [], clientesReferencia: [] },
  stats: leadFitOutcomeStats([]), people: [{ ref: 'L1', facts: { cargo: 'Gerente de Personas' }, previous: { stage: 'search', probability: 55, summary: 'Calza el cargo.' } }] }));
  assert.equal(prompt.etapa, 'En «Por escribir»');
  assert.equal(prompt.personas[0].ref, 'L1');
  assert.deepEqual(prompt.personas[0].estimacion_anterior, { etapa: 'Al buscarlo', probabilidad: 55, porque: 'Calza el cargo.' });
  assert.equal(prompt.oferta_y_cliente_ideal.cargos[0], 'Gerente de Personas');
});
