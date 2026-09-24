import assert from 'node:assert/strict';
import test from 'node:test';

import { checkHumanTone, feedbackForToneRetry } from './human-tone-checks';
import { draftContextFixture } from './draft-v2-test-fixtures';
import { validateDraftPreflightV2 } from './draft-preflight-v2';

const GOOD = {
  subject: 'dotación para el peak de diciembre',
  body: [
    'Hola Rodrigo,',
    '',
    'Vi que abren dos tiendas nuevas en la zona sur antes de fin de año. En esas aperturas lo difícil suele ser que la gente dure hasta enero.',
    '',
    'Nosotros ponemos reponedores y cajeros por temporada, y nos hacemos cargo del reemplazo si alguien no llega.',
    '',
    '¿Tienen resuelto el refuerzo de diciembre o te sirve que lo conversemos?',
  ].join('\n'),
};

test('human tone accepts a concrete human email without findings', () => {
  const result = checkHumanTone({ ...GOOD, maxModelQuestions: 1 });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('human tone blocks template openers and inflated language', () => {
  const result = checkHumanTone({
    subject: 'Propuesta Comercial De Servicios',
    body: 'Estimado Sr. González:\n\nEspero que este correo lo encuentre muy bien. Somos líderes en soluciones integrales de outsourcing para potenciar su operación.\n\nQuedo a su entera disposición.',
  });
  const codes = result.errors.map((finding) => finding.code);
  assert.ok(codes.includes('tone_muletilla'));
  assert.ok(codes.includes('tone_asunto'));
  assert.ok(result.errors.every((finding) => finding.blocking));
  assert.ok(feedbackForToneRetry(result.errors).length > 0);
});

test('human tone blocks em-dashes, bullets, emojis and extra questions', () => {
  const dashes = checkHumanTone({ subject: 'turnos noche en Pudahuel', body: 'Hola Felipe,\n\nEl turno — como sabes — cuesta cubrir.\n\n¿Conversamos?' });
  assert.ok(dashes.errors.some((finding) => finding.code === 'tone_formato'));

  const bullets = checkHumanTone({ subject: 'dotación para diciembre', body: 'Hola Rodrigo,\n\nTenemos:\n· Reponedores\n· Cajeros\n\n¿Conversamos?' });
  assert.ok(bullets.errors.some((finding) => finding.code === 'tone_formato'));

  const questions = checkHumanTone({ subject: 'dotación para diciembre', body: 'Hola Rodrigo,\n\n¿Tienen resuelto diciembre? ¿O prefieren enero? ¿Llamamos?', maxModelQuestions: 1 });
  assert.ok(questions.errors.some((finding) => finding.code === 'tone_pregunta'));

  const initial = checkHumanTone({ subject: 'dotación para diciembre', body: 'Hola Rodrigo,\n\n¿Tienen resuelto diciembre?\n\n¿Te parece si lo conversamos 15 minutos esta semana?', ctaExactText: '¿Te parece si lo conversamos 15 minutos esta semana?', maxModelQuestions: 0 });
  assert.ok(initial.errors.some((finding) => finding.code === 'tone_pregunta'));

  const initialClean = checkHumanTone({ subject: 'dotación para diciembre', body: 'Hola Rodrigo,\n\nPara diciembre podrían sumar refuerzo por un período acotado.\n\n¿Te parece si lo conversamos 15 minutos esta semana?', ctaExactText: '¿Te parece si lo conversamos 15 minutos esta semana?', maxModelQuestions: 0 });
  assert.deepEqual(initialClean.errors, []);
});

test('human tone blocks tuteo/usted mixing but accepts consistent usted', () => {
  const mixed = checkHumanTone({ subject: 'dotación en faena', body: 'Hola Paula,\n\nLe escribo por la dotación. ¿Te parece si lo conversamos?' });
  assert.ok(mixed.errors.some((finding) => finding.code === 'tone_tratamiento'));

  const usted = checkHumanTone({ subject: 'dotación en faena', body: 'Hola Paula,\n\nLe escribo por la dotación temporal en faena. Su equipo podría sumar personal por un período acotado.\n\n¿Le parece si lo conversamos?' });
  assert.deepEqual(usted.errors, []);
});

test('human tone blocks company-definition openings', () => {
  const ficha = checkHumanTone({
    subject: 'dotación temporal en tiendas',
    body: 'Hola Rodrigo,\n\nPara una cadena de retail con 40 tiendas en la zona sur como Tiendas Ejemplo, sumar personal puede servir.\n\n¿Conversamos?',
    companyName: 'Tiendas Ejemplo',
  });
  assert.ok(ficha.errors.some((finding) => finding.code === 'tone_ficha'));
  const signal = checkHumanTone({
    subject: 'dotación para las nuevas tiendas',
    body: 'Hola Rodrigo,\n\nTiendas Ejemplo abrirá dos tiendas nuevas en la zona sur antes de diciembre. Para esa puesta en marcha podría servir refuerzo temporal.\n\n¿Conversamos?',
    companyName: 'Tiendas Ejemplo',
  });
  assert.deepEqual(signal.errors, []);
});

test('ficha feedback points to industry observation when no signal exists', () => {
  const without = checkHumanTone({
    subject: 'dotación en faena', body: 'Hola Paula,\n\nEn una faena como la de Minera Cascada, con más de 2.000 trabajadores, la dotación temporal puede servir.\n\n¿Conversamos?',
    companyName: 'Minera Cascada',
  });
  assert.ok(without.errors.some((finding) => finding.code === 'tone_ficha' && /observación honesta/.test(finding.message)));
  const withSignal = checkHumanTone({
    subject: 'dotación en faena', body: 'Hola Paula,\n\nEn una faena como la de Minera Cascada, con más de 2.000 trabajadores, la dotación temporal puede servir.\n\n¿Conversamos?',
    companyName: 'Minera Cascada', hasSignal: true,
  });
  assert.ok(withSignal.errors.some((finding) => finding.code === 'tone_ficha' && /dato fechado/.test(finding.message)));
});

test('human tone warns on review words and contrasts without blocking', () => {
  const result = checkHumanTone({ subject: 'dotación para diciembre', body: 'Hola Rodrigo,\n\nPodemos optimizar la cobertura de diciembre. No es solo personal, es continuidad.\n\n¿Conversamos?' });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.length > 0);
});

test('preflight warns when the approved CTA mixes tratamiento with an usted body', () => {
  const context = draftContextFixture();
  const output = {
    subject: 'dotación en faena',
    body: 'Hola Paula,\n\nLe escribo por la dotación temporal en faena. Su equipo podría sumar personal por un período acotado.\n\n¿Te parece si lo conversamos 15 minutos esta semana?',
    personalization: [{ evidenceId: context.evidence[0].evidenceId, claimId: 'claim-acme-overview', sourceUrl: context.evidence[0].source.url }],
    hypothesisIds: [],
  };
  const result = validateDraftPreflightV2(context, output, { checkGeneratedCopy: true, checkHumanTone: true });
  assert.ok(result.preflight.warnings.some((w) => /otro tratamiento/.test(w)));
});
