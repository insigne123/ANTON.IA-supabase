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

test('human tone warns instead of blocking ficha when no signal exists', () => {
  const ficha = checkHumanTone({
    subject: 'dotación temporal en tiendas',
    body: 'Hola Rodrigo,\n\nPara una cadena de retail con 40 tiendas en la zona sur como Tiendas Ejemplo, sumar personal puede servir.\n\n¿Conversamos?',
    companyName: 'Tiendas Ejemplo',
    hasSignal: false,
  });
  assert.deepEqual(ficha.errors, []);
  assert.ok(ficha.warnings.some((finding) => finding.code === 'tone_ficha'));
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

test('human tone blocks the bridges that say nothing', () => {
  for (const sentence of ['La puesta en marcha puede implicar sumar personal.', 'Así, el equipo puede revisar opciones con más agilidad.', 'Es una alternativa para cubrir la conserjería.'])
    assert.ok(checkHumanTone({ subject: 'Dotación para diciembre', body: `Hola Rodrigo,\n\n${sentence}\n\n¿Conversamos?` }).errors.some((finding) => finding.code === 'tone_muletilla'), sentence);
});

test('human tone blocks the same bridges with words in between, and leaves a real cost alone', () => {
  // Bank drafts of 30 Oct 2026 (v24) that still passed.
  for (const sentence of ['La dotación se ajusta y su costo acompaña la cosecha.', 'El costo de esa dotación acompaña el peak.', 'Así puede sumar personal durante esas aperturas.', 'Administrar contratos también puede acompañar la incorporación.', 'Así, ese turno puede volver a tener cobertura.'])
    assert.ok(checkHumanTone({ subject: 'Dotación para diciembre', body: `Hola Rodrigo,\n\n${sentence}\n\n¿Conversamos?` }).errors.some((finding) => finding.code === 'tone_muletilla'), sentence);
  for (const sentence of ['El costo termina cuando termina la cosecha.', 'Acompañamos la apertura con dos personas por tienda.', 'Así que el equipo puede revisarlo el lunes.'])
    assert.ok(!checkHumanTone({ subject: 'Dotación para diciembre', body: `Hola Rodrigo,\n\n${sentence}\n\n¿Conversamos?` }).errors.some((finding) => finding.code === 'tone_muletilla'), sentence);
});

test('human tone blocks a sentence left without its verb, not a short sentence by style', async () => {
  const { sentenceFragments } = await import('./human-tone-checks');
  // A draft of 29 Oct 2026 opened like this, and the person had to rewrite it.
  const broken = checkHumanTone({ subject: 'Tests para servicios transitorios', body: 'Hola Cristian,\n\nPara selección en servicios transitorios.\n\nOfrecemos más de 45 tests para evaluar postulantes online.' });
  assert.ok(broken.errors.some((finding) => finding.code === 'tone_fragmento' && finding.blocking && /Para selección en servicios transitorios/.test(finding.message)));

  assert.deepEqual(sentenceFragments(GOOD.body), []);
  assert.deepEqual(sentenceFragments('Hola Ana,\n\nUn solo proveedor para personal, aseo y seguridad. ¿Cuántos turnos cubren al mes?'), [], 'a short sentence of another kind is style');
  assert.deepEqual(sentenceFragments('Hola Paula,\n\nLe escribo por la dotación temporal en faena. Con la temporada encima, cubrimos turnos el mismo día.'), []);
  assert.deepEqual(sentenceFragments('Hola,\n\nPara selección en servicios transitorios. Cuando entran muchos guardias a la vez, cubrimos el turno.'), ['Para selección en servicios transitorios.']);
  assert.deepEqual(sentenceFragments('Hola,\n\nCon este correo cierro el tema. Con AXIS, cargas la lista de postulantes.'), [], 'the first and second person are verbs');
});
