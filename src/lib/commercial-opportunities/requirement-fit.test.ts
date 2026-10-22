import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionWithFit, extraQuestionKey, fitSummary, isExtraQuestionKey, requirementFitPrompt, requirementFitSchema, resolveRequirementFit } from './requirement-fit';
import { reportItemKey } from './report-marks';
import { EMPTY_TENDER_PROFILE, tenderProfileForModel } from './tender-profile';

const requirement = (title: string, cited = true) => ({ title, status: 'supported' as const, evidence: cited ? [{ chunkId: 'c1', quote: title }] : [], action: '', role: '', due: '' });
const report = { recommendation: 'do_not_advance' as const, reasons: ['Exigen ISO 9001'], requirements: [
  requirement('Certificación ISO 9001 vigente'), requirement('Boleta de garantía de seriedad por $4.500.000'), requirement('Presentar anexo N.º 1 firmado'),
  requirement('Presencia en la Región de Los Lagos'), requirement('Experiencia de 3 años', false),
] };

test('a «no cumples» needs a cited requirement and a fact of the profile; otherwise it is a question', () => {
  const fit = resolveRequirementFit(report, { noRestsOnRequirements: true, extraQuestions: [], requirements: [
    { index: 0, fit: 'meets', basis: 'certificaciones: ISO 9001', question: '', answerKind: 'yesno' },
    { index: 1, fit: 'fails', basis: '', question: '¿Pueden entregar una boleta por $4.500.000?', answerKind: 'yesno' },
    { index: 2, fit: 'na', basis: 'x', question: 'y', answerKind: 'yesno' },
    { index: 3, fit: 'fails', basis: 'regiones: Metropolitana', question: '', answerKind: 'yesno' },
    { index: 4, fit: 'fails', basis: 'años en el rubro: 2', question: '', answerKind: 'yesno' },
  ] }, 4, new Date('2026-10-18T12:00:00Z'));
  const at = (index: number) => fit.items[reportItemKey('requirement', report.requirements[index].title)];
  assert.deepEqual(at(0), { fit: 'meets', basis: 'certificaciones: ISO 9001', question: null });
  assert.deepEqual(at(1), { fit: 'missing', basis: '', question: '¿Pueden entregar una boleta por $4.500.000?' }, 'no fact against it: a question');
  assert.deepEqual(at(2), { fit: 'na', basis: '', question: null });
  assert.equal(at(3).fit, 'fails');
  assert.equal(at(4).fit, 'missing', 'a requirement without a citation of the bases cannot leave the company out');
  assert.match(at(4).question!, /^¿Cumplen con esto: Experiencia de 3 años\?$/);
  assert.deepEqual([fit.profileRevision, fit.createdAt], [4, '2026-10-18T12:00:00.000Z']);
  assert.deepEqual(fitSummary(fit), { meets: 1, missing: 2, fails: 1 });
  const unanswered = resolveRequirementFit(report, { noRestsOnRequirements: false, extraQuestions: [], requirements: [{ index: 0, fit: 'meets', basis: '', question: '', answerKind: 'yesno' }] }, 1);
  assert.equal(unanswered.items[reportItemKey('requirement', report.requirements[0].title)].fit, 'missing', 'a «cumples» without a basis is not taken');
  assert.equal(Object.values(unanswered.items).filter(item => item.fit === 'missing').length, 5, 'what the model skipped is asked');
});

test('«No postular» on unproven requirements reads as conditional; a proven «no cumples» stops a «Postular»', () => {
  const key = (index: number) => reportItemKey('requirement', report.requirements[index].title);
  const open = { items: { [key(0)]: { fit: 'meets' as const, basis: 'ISO 9001', question: null }, [key(1)]: { fit: 'missing' as const, basis: '', question: '¿Boleta?' } },
    noRestsOnRequirements: true, profileRevision: 2, createdAt: '' };
  const softened = decisionWithFit(report, open);
  assert.equal(softened.recommendation, 'conditional');
  assert.match(softened.note!, /no encontramos un requisito que te deje fuera: responde la pregunta/);
  const proven = { ...open, items: { ...open.items, [key(3)]: { fit: 'fails' as const, basis: 'regiones: Metropolitana', question: null } } };
  assert.deepEqual(decisionWithFit(report, proven), { recommendation: 'do_not_advance', note: null }, 'with evidence the «no» stays');
  assert.deepEqual(decisionWithFit(report, { ...open, noRestsOnRequirements: false }), { recommendation: 'do_not_advance', note: null }, 'a «no» for other reasons (dates, product) stays');
  const go = decisionWithFit({ ...report, recommendation: 'advance' }, proven);
  assert.equal(go.recommendation, 'conditional');
  assert.match(go.note!, /no cumples un requisito/);
  assert.deepEqual(decisionWithFit(report, null), { recommendation: 'do_not_advance', note: null }, 'without a reading nothing changes');
});

test('the prompt reads the requirements with their citation and the profile with its «no sé»', () => {
  const prompt = requirementFitPrompt({ report, ficha: tenderProfileForModel({ ...EMPTY_TENDER_PROFILE, notes: [{ question: '¿Boleta por $4.500.000?', answer: 'Sí', at: '' }] }), offer: 'Aseo' });
  assert.match(prompt, /Nunca uses fails por falta de información/);
  assert.match(prompt, /"index":1,"titulo":"Boleta de garantía de seriedad por \$4\.500\.000"/);
  assert.match(prompt, /"cita":null/, 'an uncited requirement says so');
  assert.match(prompt, /"garantiaMaximaQuePuedeEntregar":"no sé"/);
  assert.match(prompt, /"selloEmpresaMujer":"no sé"/);
  assert.match(prompt, /mira «selloEmpresaMujer» de la ficha y no la lista de certificaciones/);
  assert.match(prompt, /"respuestasDeLaEmpresa":\["¿Boleta por \$4\.500\.000\? → Sí"\]/, 'the company\'s answers count as facts');
});

test('a question that takes figures or names says so, and the extra questions for the offer are kept apart, once each and never repeated', () => {
  const fit = resolveRequirementFit(report, { noRestsOnRequirements: false, requirements: [
    { index: 1, fit: 'missing', basis: '', question: '¿Cuántos contratos de aseo por más de $20.000.000 ha ejecutado desde 2023, con qué clientes y por qué montos?', answerKind: 'detail' },
    { index: 2, fit: 'missing', basis: '', question: '¿Pueden entregar una boleta de garantía por $4.500.000?', answerKind: 'yesno' },
  ], extraQuestions: [
    { question: '¿Desde qué fecha podrían empezar el servicio?', why: 'Las bases piden inicio inmediato.', answerKind: 'detail' },
    { question: '¿Pueden entregar una boleta de garantía por $4.500.000?', why: 'repetida', answerKind: 'yesno' },
    { question: '¿Desde qué fecha podrían empezar el servicio?', why: 'otra vez', answerKind: 'detail' },
    { question: 'corta', why: '', answerKind: 'yesno' },
  ] }, 3);
  const at = (index: number) => fit.items[reportItemKey('requirement', report.requirements[index].title)];
  assert.equal(at(1).answerKind, 'detail');
  assert.equal(at(2).answerKind, undefined, 'a yes or a no is the default and is not stored');
  const extras = Object.entries(fit.items).filter(([key]) => isExtraQuestionKey(key));
  assert.equal(extras.length, 1, 'a repeated or too short question is not asked');
  assert.deepEqual(extras[0][1], { fit: 'missing', basis: 'Las bases piden inicio inmediato.', question: '¿Desde qué fecha podrían empezar el servicio?', answerKind: 'detail' });
  assert.equal(extras[0][0], extraQuestionKey('¿Desde qué fecha podrían empezar el servicio?'));
  assert.equal(isExtraQuestionKey(reportItemKey('requirement', 'Certificación ISO 9001 vigente')), false);
  // The summary and the decision count the requirements, not the extra questions.
  assert.deepEqual(fitSummary(fit), { meets: 0, missing: 5, fails: 0 });
  assert.equal(requirementFitSchema.safeParse({ noRestsOnRequirements: false, requirements: [], extraQuestions: [] }).success, true);
  assert.equal(requirementFitSchema.safeParse({ noRestsOnRequirements: false, requirements: [{ index: 0, fit: 'missing', basis: '', question: 'x'.repeat(320), answerKind: 'detail' }], extraQuestions: [] }).success, true);
});

test('the prompt asks for every question needed: one complete question per requirement, the kind of answer, and what the offer needs besides', () => {
  const prompt = requirementFitPrompt({ report, ficha: {}, offer: 'Aseo' });
  assert.match(prompt, /Clasifica TODOS los requisitos, sin saltarte ninguno/);
  assert.match(prompt, /UNA pregunta clara y completa que reúna todo lo que falta saber/);
  assert.match(prompt, /answerKind detail cuando hace falta una cifra, nombres o varias cosas/);
  assert.match(prompt, /extraQuestions: hasta 8 preguntas/);
  assert.match(prompt, /la base de precio o los costos/);
});
