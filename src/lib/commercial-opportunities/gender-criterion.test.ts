import assert from 'node:assert/strict';
import test from 'node:test';
import { genderCriterion, sealNote } from './gender-criterion';
import { EMPTY_TENDER_PROFILE, femaleLedSeal } from './tender-profile';

// Invented bases: the passage that values a company led by women sits in the evaluation section.
const report = (paragraph: string, extra: Record<string, unknown> = {}) => ({
  executive: 'Servicio de aseo para un hospital.', reasons: ['Coincide con tu oferta'],
  sections: [{ id: 'evaluation', title: 'Cómo se evalúa y cómo ganar puntaje', paragraphs: [paragraph], facts: [] }],
  requirements: [{ title: 'Boleta de seriedad', status: 'pending' as const, evidence: [], action: 'Entregar la boleta.', role: '', due: '' }], ...extra,
}) as Parameters<typeof genderCriterion>[0];

test('a report is read for the passage where the bases value a company led by women, in the words the bases use', () => {
  const found = genderCriterion(report('Precio 70 %. Experiencia 20 %. Se asignarán 5 puntos a las empresas lideradas por mujeres que cuenten con el Sello Empresa Mujer. Plazo 10 %.'));
  assert.deepEqual(found, { where: 'Cómo se evalúa y cómo ganar puntaje', sentence: 'Se asignarán 5 puntos a las empresas lideradas por mujeres que cuenten con el Sello Empresa Mujer.' });
  for (const phrase of ['Criterio de equidad de género: 5 %', 'Se valorará la perspectiva de género de la propuesta', 'Preferencia a mujeres emprendedoras', 'Sello Mujer vigente', 'empresas administradas por mujeres', 'igualdad de género en el equipo'])
    assert.ok(genderCriterion(report(phrase)), phrase);
  // The requirements and the summary count as well.
  assert.equal(genderCriterion(report('Sin criterios especiales.', { requirements: [{ title: 'Acreditar el Sello Empresa Mujer', status: 'pending', evidence: [], action: '', role: '', due: '' }] }))?.where, 'Requisitos para postular');
});

test('a report that does not value it says nothing, and a text that only mentions women is not a criterion', () => {
  assert.equal(genderCriterion(report('Precio 80 %. Experiencia 20 %. El personal femenino y masculino recibirá la misma capacitación.')), null);
  assert.equal(genderCriterion(report('Se prohíbe el trabajo de mujeres embarazadas en faenas de riesgo.')), null);
  assert.equal(sealNote(null, femaleLedSeal({ ...EMPTY_TENDER_PROFILE, legalReps: 3, legalRepsWomen: 2 })), null, 'no criterion in the bases, no note');
});

test('the note tells whether this company adds the points, must ask for the seal, or has to answer in its profile', () => {
  const criterion = genderCriterion(report('Se asignarán 5 puntos a las empresas lideradas por mujeres.'));
  const note = (extra: Partial<typeof EMPTY_TENDER_PROFILE>) => sealNote(criterion, femaleLedSeal({ ...EMPTY_TENDER_PROFILE, ...extra }))!;
  const has = note({ legalReps: 3, legalRepsWomen: 2 });
  assert.deepEqual([has.tone, has.title], ['good', 'Sumas puntaje con el Sello Empresa Mujer']);
  assert.match(has.body, /Las bases lo dicen en «Cómo se evalúa y cómo ganar puntaje»: «Se asignarán 5 puntos a las empresas lideradas por mujeres\.»/);
  assert.match(has.body, /Según tu ficha: 2 de 3 representantes legales son mujeres/);
  const ask = note({ womenOwnership: 'entre_25_50' });
  assert.deepEqual([ask.tone, ask.title], ['ask', 'Puedes sumar puntaje, pero antes hay que pedir el Sello Empresa Mujer']);
  assert.match(ask.body, /Centro de Ayuda de ChileCompra/);
  assert.match(ask.body, /antes del cierre/);
  const no = note({ legalReps: 3, legalRepsWomen: 0, womanGeneralManager: 'no', womenOwnership: 'menos_25' });
  assert.deepEqual([no.tone, no.title], ['neutral', 'Esta licitación da puntaje a empresas lideradas por mujeres, y tu ficha no cumple']);
  const unknown = note({});
  assert.equal(unknown.tone, 'ask');
  assert.match(unknown.body, /responde en tu «Ficha para licitaciones» cuántos de tus representantes legales son mujeres/);
  assert.equal(sealNote(criterion, null)!.tone, 'ask', 'before the company has a profile');
});
